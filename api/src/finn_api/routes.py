"""HTTP surface for the FINN app. Thin by design: crons and Hermes do the work."""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import UTC, datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from finn_api.auth import require_auth
from finn_api.brain import Brain
from finn_api.config import settings
from finn_api.db import get_db
from finn_api.digest import _item, build_digest
from finn_api.models import Document, FeedItem, Holding, User
from finn_api.pipeline import onboard
from finn_api.results import results_card
from finn_api.sources.nse import NSE

router = APIRouter(prefix="/api", dependencies=[Depends(require_auth)])


def current_user(db: Session = Depends(get_db)) -> User:
    # Single-investor prototype: the first user is "me".
    user = db.scalar(select(User).order_by(User.created_at))
    if user is None:
        user = User(name="Investor")
        db.add(user)
        db.commit()
    return user


# ── push side ─────────────────────────────────────────────────────────────


@router.get("/digest")
def digest(
    hours: int = 24,
    since: datetime | None = None,
    until: datetime | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return build_digest(db, user.id, hours=hours, since=since, until=until)


@router.get("/feed/{item_id}")
def feed_item(item_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    item = db.get(FeedItem, item_id)
    if not item or item.user_id != user.id:
        raise HTTPException(404)
    related = []
    if item.story_key:
        related = [_item(i) for i in db.scalars(
            select(FeedItem).where(FeedItem.user_id == user.id, FeedItem.story_key == item.story_key,
                                   FeedItem.id != item.id))]
    return {**_item(item), "related": related}


@router.get("/stories/{item_id}")
def story_for(item_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The whole story an item belongs to (situations span days), clustered like the digest."""
    from finn_api.digest import cluster, situation_summary

    item = db.get(FeedItem, item_id)
    if not item or item.user_id != user.id:
        raise HTTPException(404)
    lo, hi = item.event_at - timedelta(days=12), item.event_at + timedelta(days=12)
    nearby = list(db.scalars(select(FeedItem).where(
        FeedItem.user_id == user.id, FeedItem.symbol == item.symbol,
        FeedItem.event_at >= lo, FeedItem.event_at <= hi)))
    for key, group in cluster(nearby).items():
        if any(g.id == item.id for g in group):
            situation = ":situation:" in key
            group.sort(key=(lambda i: (i.kind == "signal", i.event_at)) if situation
                       else (lambda i: (-i.tier, i.event_at)))
            head = group[0]
            extra = situation_summary(group) if situation and len(group) > 1 else {}
            return {**extra, "story_key": key, "symbol": item.symbol, "tier": head.tier,
                    "head": _item(head), "related": [_item(g) for g in group[1:]],
                    "event_at": max(g.event_at for g in group).isoformat(),
                    "company": json.loads(head.payload_json or "{}").get("company")}
    raise HTTPException(404)


class FeedAction(BaseModel):
    seen: bool | None = None
    dismissed: bool | None = None


@router.patch("/feed/{item_id}")
def update_feed(item_id: str, body: FeedAction, user: User = Depends(current_user), db: Session = Depends(get_db)):
    item = db.get(FeedItem, item_id)
    if not item or item.user_id != user.id:
        raise HTTPException(404)
    if body.seen is not None:
        item.seen = body.seen
    if body.dismissed is not None:
        item.dismissed = body.dismissed
    db.commit()
    return _item(item)


class Settings(BaseModel):
    volume_x: float | None = Field(default=None, ge=1.0, le=20)
    price_pct: float | None = Field(default=None, ge=0.5, le=30)
    overrides: dict[str, dict] | None = None
    alert_categories: list[str] | None = None


@router.get("/me")
def me(user: User = Depends(current_user)):
    t = {"volume_x": 2.0, "price_pct": 5.0, "overrides": {}} | json.loads(user.thresholds_json or "{}")
    return {"id": user.id, "name": user.name, "thresholds": t,
            "alert_categories": json.loads(user.alert_categories_json)}


@router.put("/me")
def update_me(body: Settings, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = json.loads(user.thresholds_json or "{}")
    for k in ("volume_x", "price_pct", "overrides"):
        if getattr(body, k) is not None:
            t[k] = getattr(body, k)
    user.thresholds_json = json.dumps(t)
    if body.alert_categories is not None:
        user.alert_categories_json = json.dumps(body.alert_categories)
    db.commit()
    return me(user)


class PushToken(BaseModel):
    token: str
    kind: str = "fcm"  # native device token from the app; "expo" for Expo push tokens


@router.post("/push-token")
def push_token(body: PushToken, user: User = Depends(current_user), db: Session = Depends(get_db)):
    tokens = set(json.loads(user.push_tokens_json or "[]"))
    tokens.add(f"fcm:{body.token}" if body.kind == "fcm" else body.token)
    user.push_tokens_json = json.dumps(sorted(tokens))
    db.commit()
    return {"ok": True, "tokens": len(tokens)}


# ── portfolio ─────────────────────────────────────────────────────────────


@router.get("/holdings")
def holdings(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Holding).where(Holding.user_id == user.id).order_by(Holding.weight.desc())).all()
    nse = NSE()
    last = {}
    try:
        days = nse.recent_bhavcopies(1)
        last = days[-1] if days else {}
    except Exception:
        pass
    out = []
    for h in rows:
        bar = last.get(h.symbol)
        out.append({
            "symbol": h.symbol, "name": h.name, "industry": h.industry, "weight": h.weight,
            "watch_only": h.watch_only,
            "close": bar and bar.close, "change_pct": bar and bar.change_pct,
            "volume": bar and bar.volume, "day": bar and bar.day.isoformat(),
        })
    return out


@router.get("/holdings/prices")
def holdings_prices(days: int = 30, user: User = Depends(current_user), db: Session = Depends(get_db)):
    syms = {h.symbol for h in db.scalars(select(Holding).where(Holding.user_id == user.id))}
    out: dict[str, list[float]] = {s: [] for s in syms}
    for bars in NSE().recent_bhavcopies(min(max(days, 5), 120)):
        for s in syms:
            if s in bars:
                out[s].append(bars[s].close)
    return out


class Onboard(BaseModel):
    symbols: list[str]
    weights: dict[str, float] = {}
    days: int = 30


@router.post("/holdings")
def add_holdings(body: Onboard, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return onboard(db, NSE(), user, body.symbols, weights=body.weights, backfill_days=body.days)


@router.delete("/holdings/{symbol}")
def remove_holding(symbol: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    h = db.scalar(select(Holding).where(Holding.user_id == user.id, Holding.symbol == symbol.upper()))
    if h:
        db.delete(h)
        db.commit()
    return {"ok": True}


# ── company brain (pull side reads) ───────────────────────────────────────


@router.get("/companies/{symbol}/results")
def company_results(symbol: str):
    card = results_card(NSE(), symbol)
    if not card:
        raise HTTPException(404, "no XBRL results filings found")
    return card


@router.get("/companies/{symbol}/documents")
def company_documents(symbol: str, db: Session = Depends(get_db)):
    docs = db.scalars(select(Document).where(Document.symbol == symbol.upper())
                      .order_by(Document.filed_at.desc())).all()
    return [{
        "id": d.id, "desc": d.desc, "url": d.url, "pages": d.pages, "doc_type": d.doc_type,
        "triage_by": d.triage_by, "triage": json.loads(d.triage_json or "{}"), "decision": d.decision,
        "status": d.status, "engine": d.engine, "wiki_path": d.wiki_path, "tree_path": d.tree_path,
        "filed_at": d.filed_at and d.filed_at.isoformat(),
    } for d in docs]


@router.post("/documents/{doc_id}/parse")
def parse_document(doc_id: str, db: Session = Depends(get_db)):
    from finn_api.ingest import parse_now

    try:
        d = parse_now(db, NSE(), doc_id)
    except KeyError as e:
        raise HTTPException(404, "no such document") from e
    return {"id": d.id, "status": d.status, "wiki_path": d.wiki_path, "tree_path": d.tree_path, "engine": d.engine}


_DOSSIER_JOBS: dict[str, dict] = {}


@router.get("/companies/{symbol}/dossier")
def get_dossier(symbol: str):
    sym = symbol.upper()
    p = Brain(sym).wiki / "dossier" / "dossier.json"
    job = _DOSSIER_JOBS.get(sym)
    if not p.exists():
        return {"symbol": sym, "status": job["status"] if job else "missing", "dossier": None, "error": job and job.get("error")}
    return {"symbol": sym, "status": job["status"] if job else "ready", "dossier": json.loads(p.read_text())}


@router.post("/companies/{symbol}/dossier")
def start_dossier(symbol: str):
    """Build (or rebuild) the grounded dossier in the background. Works for any NSE symbol."""
    import threading

    from finn_api.db import SessionLocal
    from finn_api.research import build_dossier

    sym = symbol.upper()
    if _DOSSIER_JOBS.get(sym, {}).get("status") == "building":
        return {"symbol": sym, "status": "building"}
    _DOSSIER_JOBS[sym] = {"status": "building", "started": datetime.now(UTC).isoformat()}

    def work():
        try:
            with SessionLocal() as db:
                build_dossier(db, NSE(), sym)
            _DOSSIER_JOBS[sym] = {"status": "ready"}
        except Exception as e:  # surfaced to the app
            _DOSSIER_JOBS[sym] = {"status": "failed", "error": str(e)[:300]}

    threading.Thread(target=work, daemon=True).start()
    return {"symbol": sym, "status": "building"}


@router.get("/companies/{symbol}/brain")
def company_brain(symbol: str):
    b = Brain(symbol)
    if not b.exists:
        raise HTTPException(404, "no brain yet — onboard or research this symbol first")
    return {"symbol": b.symbol, "pages": b.pages(), "index": b.read("index.md"), "tree": _brain_tree(b)}


# What each brain folder holds, in the order a reader should meet them.
_FOLDERS = [
    ("dossier", "Dossier", "FINN's research: snapshot, promised vs delivered, bull and bear"),
    ("results", "Results", "Quarterly numbers from NSE XBRL"),
    ("transcripts", "Call transcripts", "What management said, quarter by quarter"),
    ("annual-reports", "Annual reports", "Read and indexed page by page"),
    ("filings", "Filings", "Every exchange filing, by month"),
    ("people", "People", "Directors and key managers"),
    ("news", "News", "Context only; research never cites it"),
]


def _title(path) -> str:
    try:
        with open(path, encoding="utf-8") as f:
            for _ in range(8):
                line = f.readline()
                if not line:
                    break
                if line.startswith("# "):
                    return line[2:].strip()[:120]
    except OSError:
        pass
    return ""


def _brain_tree(b: Brain) -> list[dict]:
    """The brain as folders → pages, with titles, including folders that are still empty."""
    wiki = b.wiki
    top = [{"path": p, "title": _title(wiki / p) or p.removesuffix(".md")} for p in
           ("index.md", "profile.md", "guidance-ledger.md", "log.md") if (wiki / p).exists()]
    known = {name for name, _, _ in _FOLDERS}
    extra = sorted(d.name for d in wiki.iterdir() if d.is_dir() and d.name not in known) if wiki.is_dir() else []
    folders = []
    for name, label, about in [*_FOLDERS, *[(x, x.replace("-", " ").capitalize(), "") for x in extra]]:
        d = wiki / name
        if not d.is_dir():
            continue
        pages = sorted((p for p in d.rglob("*.md") if "trees" not in p.relative_to(d).parts),
                       key=lambda p: p.name, reverse=True)
        trees = {p.name for p in (d / "trees").glob("*.md")} if (d / "trees").is_dir() else set()
        folders.append({
            "name": name, "label": label, "about": about,
            "pages": [{"path": str(p.relative_to(wiki)), "title": _title(p) or p.stem,
                       "tree": f"{name}/trees/{p.name}" if p.name in trees else None} for p in pages],
        })
    return [{"name": "", "label": "", "about": "", "pages": top}, *folders]


# ── brain search: SQLite FTS5 over heading-sized chunks, rebuilt when a page changes ──

_FTS: dict[str, tuple[float, sqlite3.Connection]] = {}


def _chunks(text: str, size: int = 1800):
    """Split a page at its headings, then into ~size-char pieces, keeping the nearest heading."""
    heading, buf = "", []
    for line in text.splitlines():
        if line.startswith("#"):
            if buf:
                yield heading, "\n".join(buf)
            heading, buf = line.lstrip("#").strip(), []
            continue
        buf.append(line)
        if sum(len(x) for x in buf) > size:
            yield heading, "\n".join(buf)
            buf = []
    if buf:
        yield heading, "\n".join(buf)


def _brain_index(b: Brain) -> sqlite3.Connection:
    files = [p for p in b.wiki.rglob("*.md")]
    stamp = max((p.stat().st_mtime for p in files), default=0) + len(files)
    hit = _FTS.get(b.symbol)
    if hit and hit[0] == stamp:
        return hit[1]
    con = sqlite3.connect(":memory:", check_same_thread=False)
    con.execute("create virtual table c using fts5(path unindexed, title, heading, body, tokenize='porter unicode61')")
    rows = []
    for p in files:
        rel = str(p.relative_to(b.wiki))
        if "/trees/" in f"/{rel}":
            continue  # PageIndex trees repeat the report's own headings
        text = p.read_text(encoding="utf-8", errors="ignore")
        title = _title(p) or p.stem
        rows += [(rel, title, h, body) for h, body in _chunks(text) if body.strip()]
    con.executemany("insert into c values (?,?,?,?)", rows)
    _FTS[b.symbol] = (stamp, con)
    return con


def _fts_query(q: str) -> str:
    # Words as prefix terms, ANDed; quotes keep FTS syntax out of user input.
    words = re.findall(r"[\w%.-]+", q)[:8]
    return " ".join(f'"{w}"*' for w in words)


def _clean_heading(h: str) -> str:
    return re.sub(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", lambda m: m.group(2) or m.group(1).split("/")[-1], h)[:80]


@router.get("/companies/{symbol}/brain/search")
def brain_search(symbol: str, q: str, limit: int = 20):
    b = Brain(symbol)
    if not b.exists:
        raise HTTPException(404, "no brain yet")
    query = _fts_query(q)
    if not query:
        return []
    con = _brain_index(b)
    sql = ("select path, title, heading, snippet(c, 3, '«', '»', ' … ', 18) from c where c match ? "
           "order by bm25(c, 0, 4, 2, 1) limit ?")
    rows = con.execute(sql, (query, min(limit, 50))).fetchall()
    if not rows and " " in query:  # every word didn't match together: any word, best first
        rows = con.execute(sql, (query.replace(" ", " OR "), min(limit, 50))).fetchall()
    return [{"path": r[0], "title": r[1], "heading": _clean_heading(r[2]), "snippet": r[3]} for r in rows]


@router.get("/companies/{symbol}/brain/{path:path}")
def company_page(symbol: str, path: str):
    try:
        return {"path": path, "markdown": Brain(symbol).read(path)}
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(404, str(e)) from e


# ── chat: proxy to the Hermes `finn` profile (api_server) ─────────────────


class ChatIn(BaseModel):
    message: str
    session_id: str | None = None
    symbol: str | None = None  # opened from a card / company page
    feed_id: str | None = None


def _hermes_headers(user: User) -> dict[str, str]:
    h = {"Content-Type": "application/json", "X-Hermes-Session-Key": f"finn:{user.id}"}
    if settings.hermes_api_key:
        h["Authorization"] = f"Bearer {settings.hermes_api_key}"
    return h


@router.post("/chat")
async def chat_start(body: ChatIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    context = []
    if body.symbol:
        b = Brain(body.symbol)
        context.append(f"The investor is looking at {body.symbol.upper()}. Its brain is at {b.wiki} "
                       f"(start from index.md).")
    if body.feed_id and (item := db.get(FeedItem, body.feed_id)):
        context.append("They opened this item: " + json.dumps(_item(item), ensure_ascii=False)[:3000])
    payload = {
        "input": body.message,
        "session_id": body.session_id or f"finn-{user.id}",
        "instructions": "\n".join(context) or None,
    }
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{settings.hermes_api_url}/v1/runs", json=payload, headers=_hermes_headers(user))
    if r.status_code >= 400:
        raise HTTPException(502, f"hermes: {r.text[:300]}")
    return {**r.json(), "session_id": payload["session_id"]}


@router.get("/chat/{run_id}/events")
async def chat_events(run_id: str, request: Request, user: User = Depends(current_user)):
    async def relay():
        async with (
            httpx.AsyncClient(timeout=None) as c,
            c.stream("GET", f"{settings.hermes_api_url}/v1/runs/{run_id}/events",
                     headers=_hermes_headers(user)) as r,
        ):
            async for chunk in r.aiter_raw():
                if await request.is_disconnected():
                    break
                yield chunk

    return StreamingResponse(relay(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/chat/{run_id}/stop")
async def chat_stop(run_id: str, user: User = Depends(current_user)):
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(f"{settings.hermes_api_url}/v1/runs/{run_id}/stop", headers=_hermes_headers(user))
    return {"ok": r.status_code < 400}


@router.get("/status")
def status(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """FINN's own pulse: what it read today vs what it kept for you (the sieve)."""
    from datetime import date as _date

    from finn_api.sources.taxonomy import ROUTINE, classify

    holdings = {h.symbol for h in db.scalars(select(Holding).where(Holding.user_id == user.id))}
    nse = NSE()
    try:
        rows = nse.announcements(start=_date.today() - timedelta(days=1), end=_date.today(), max_age=600)
    except Exception:
        rows = []
    # Rolling 24h in IST (NSE timestamps are IST wall-clock).
    cutoff = (datetime.now(UTC) + timedelta(hours=5, minutes=30) - timedelta(hours=24)).strftime("%Y-%m-%d %H:%M:%S")
    rows = [r for r in rows if (r.get("sort_date") or "") >= cutoff]
    mine = [r for r in rows if (r.get("symbol") or "").upper() in holdings]
    d = build_digest(db, user.id, hours=24)
    last = max((r.get("sort_date") or "" for r in rows), default="") or None
    return {
        "watching": len(holdings),
        "read_24h": len(rows),
        "yours_24h": len(mine),
        "routine_24h": sum(1 for r in mine if classify(r.get("desc", ""), r.get("attchmntText", "")).tier == ROUTINE),
        "kept_24h": d["counts"]["alert"] + d["counts"]["brief"],
        "alerts_24h": d["counts"]["alert"],
        "last_filing_at": last,
        "checked_at": datetime.now(UTC).isoformat(),
    }


@router.get("/companies/{symbol}/prices")
def company_prices(symbol: str, days: int = 30):
    sym = symbol.upper()
    out = []
    for bars in NSE().recent_bhavcopies(min(max(days, 5), 120)):
        b = bars.get(sym)
        if b:
            out.append({"day": b.day.isoformat(), "close": b.close, "change_pct": b.change_pct, "volume": b.volume})
    if not out:
        raise HTTPException(404, "no price history")
    return out


@router.get("/health/sources")
def sources_health():
    """Which upstreams answer right now (and whether we're on cache)."""
    nse, out = NSE(), {}
    try:
        out["nse_announcements"] = len(nse.announcements(symbol="TCS")) > 0
    except Exception as e:
        out["nse_announcements"] = f"down: {e}"
    out["checked_at"] = datetime.now(UTC).isoformat()
    return out

"""`finn` CLI — what Hermes cron scripts call.

Every `cron` command ends with a Hermes wake gate on the last stdout line:
`{"wakeAgent": false}` when nothing needs the LLM, so most ticks cost zero tokens.
When it wakes, the lines above the gate are the agent's input.

  finn onboard TCS INFY DIXON [--weights TCS=8,INFY=6] [--days 30]
  finn cron announcements [--hours 2]
  finn cron eod
  finn digest [--hours 24]
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select

from finn_api.db import SessionLocal, init_db
from finn_api.models import FeedItem, User
from finn_api.pipeline import (
    ingest_announcements,
    onboard,
    retry_pending_results,
    run_eod,
)
from finn_api.push import send_pending
from finn_api.sources.nse import NSE


def _gate(wake: bool, items: list[dict] | None = None) -> None:
    for it in items or []:
        print(json.dumps(it, ensure_ascii=False))
    print(json.dumps({"wakeAgent": wake}))


def _default_user(db) -> User:
    user = db.scalar(select(User).order_by(User.created_at))
    if user is None:
        user = User(name="Investor")
        db.add(user)
        db.commit()
    return user


def cmd_onboard(a: argparse.Namespace) -> int:
    weights = {}
    for pair in (a.weights or "").split(","):
        if "=" in pair:
            k, v = pair.split("=", 1)
            weights[k.strip().upper()] = float(v)
    with SessionLocal() as db:
        report = onboard(db, NSE(), _default_user(db), a.symbols, weights=weights, backfill_days=a.days)
    print(json.dumps(report, indent=2, default=str))
    return 0


# Enrichment the deterministic pipeline can't do: who is this person, what does
# this order/deal mean. Only these categories ever wake the agent.
ENRICH = {"management", "mna", "orders", "rating", "distress", "legal"}


def cmd_cron_announcements(a: argparse.Namespace) -> int:
    nse = NSE()
    end = date.today()
    start = end - timedelta(days=1 if a.hours <= 24 else a.hours // 24 + 1)
    rows = nse.announcements(start=start, end=end)
    cutoff = datetime.now(UTC) - timedelta(hours=a.hours)
    with SessionLocal() as db:
        created = ingest_announcements(db, nse, rows)
        retry_pending_results(db, nse)
        for i in created:
            if i.category in ENRICH and i.event_at >= cutoff:
                i.payload_json = json.dumps(json.loads(i.payload_json or "{}") | {"enrich_pending": True})
        db.commit()
        send_pending(db)
        todo = [
            {"feed_id": i.id, "symbol": i.symbol, "category": i.category, "desc": i.title,
             "text": i.summary, "pdf": i.source_url}
            for i in created
            if i.category in ENRICH and i.event_at >= cutoff
        ]
    # One feed item per holder; enrich each filing once.
    seen, uniq = set(), []
    for t in todo:
        k = (t["symbol"], t["desc"], t["text"])
        if k not in seen:
            seen.add(k)
            uniq.append(t)
    print(f"# {len(rows)} announcements scanned, {len(created)} new for holdings, {len(uniq)} need enrichment",
          file=sys.stderr)
    _gate(bool(uniq), uniq)
    return 0


def cmd_cron_ingest(a: argparse.Namespace) -> int:
    from finn_api import ingest

    with SessionLocal() as db:
        docs = ingest.run(db, NSE(), limit=a.limit, allow_chandra=not a.no_ocr)
        rows = [{"symbol": d.symbol, "desc": d.desc, "pages": d.pages, "type": d.doc_type, "by": d.triage_by,
                 "decision": d.decision, "status": d.status, "engine": d.engine, "wiki": d.wiki_path,
                 "tree": d.tree_path, "cost": round(d.cost_usd, 5), "error": d.error} for d in docs]
    for r in rows:
        print(json.dumps(r, ensure_ascii=False), file=sys.stderr)
    _gate(False)  # ingest never needs the agent
    return 0


def cmd_cron_eod(_: argparse.Namespace) -> int:
    with SessionLocal() as db:
        created = run_eod(db, NSE())
        # Only wake the agent to explain moves that have a same-day filing to explain them.
        explain = []
        for s in created:
            day = json.loads(s.payload_json)["day"]
            related = db.scalars(
                select(FeedItem).where(
                    FeedItem.user_id == s.user_id, FeedItem.symbol == s.symbol,
                    FeedItem.kind != "signal", FeedItem.story_key.like(f"%:{day}"),
                )
            ).all()
            if related:
                explain.append({"feed_id": s.id, "symbol": s.symbol, "move": s.title,
                                "same_day_filings": [r.title + ": " + (r.summary or "")[:200] for r in related]})
        send_pending(db)
    print(f"# {len(created)} EOD signals", file=sys.stderr)
    _gate(bool(explain), explain)
    return 0


ALLOWED_PDF_HOSTS = ("nsearchives.nseindia.com", "www.bseindia.com", "archives.nseindia.com")


def cmd_pdftext(a: argparse.Namespace) -> int:
    """First pages of an exchange filing PDF as text (cached). No OCR — scanned PDFs return little."""
    from urllib.parse import urlparse

    from finn_api.sources import pdf

    host = urlparse(a.url).hostname or ""
    if host not in ALLOWED_PDF_HOSTS:
        print(json.dumps({"ok": False, "error": f"host {host} not allowed"}))
        return 1
    pages, total = pdf.pages_text(NSE().get_archive(a.url), limit=a.pages)
    text = "\n\n".join(pages).strip()
    print(json.dumps({"ok": True, "pages": total, "text": text[:12000],
                      "scanned": len(text) < 200}, ensure_ascii=False))
    return 0


def cmd_results(a: argparse.Namespace) -> int:
    from finn_api.results import results_card

    print(json.dumps(results_card(NSE(), a.symbol), indent=2, ensure_ascii=False))
    return 0


def cmd_reassess(a: argparse.Namespace) -> int:
    from finn_api.pipeline import reassess_recent

    with SessionLocal() as db:
        done = reassess_recent(db, NSE(), days=a.days, limit=a.limit, force=a.force)
        for it in done:
            m = json.loads(it.payload_json).get("materiality", {})
            print(f"{it.symbol:11} t{it.tier} {m.get('stage', '?'):5} {m.get('verdict', '?'):12} {(it.summary or '')[:110]}")
    print(f"# reassessed {len(done)} filings", file=sys.stderr)
    return 0


def cmd_token(a: argparse.Namespace) -> int:
    from finn_api.auth import mint

    print(mint(a.sub, days=a.days))
    return 0


def cmd_digest(a: argparse.Namespace) -> int:
    from finn_api.digest import build_digest

    with SessionLocal() as db:
        d = build_digest(db, _default_user(db).id, hours=a.hours)
    print(json.dumps(d, indent=2, default=str, ensure_ascii=False))
    return 0


def cmd_enrich(a: argparse.Namespace) -> int:
    """Agent write-back: one-liner and/or person bio onto a feed item (and its siblings)."""
    from finn_api.brain import Brain

    person = json.loads(a.person) if a.person else None
    with SessionLocal() as db:
        item = db.get(FeedItem, a.feed_id)
        if item is None:
            print(json.dumps({"ok": False, "error": "no such feed item"}))
            return 1
        # Same filing is one feed row per holder — enrich them all.
        siblings = db.scalars(select(FeedItem).where(FeedItem.dedup_key == item.dedup_key)).all()
        for it in siblings:
            payload = json.loads(it.payload_json or "{}")
            payload.pop("enrich_pending", None)
            if a.summary:
                payload["raw_text"] = payload.get("raw_text") or it.summary
                it.summary = a.summary
            if person:
                payload["person"] = person
            if a.importance is not None:
                payload["importance"] = a.importance
            it.payload_json = json.dumps(payload, ensure_ascii=False)
        db.commit()
        if person and person.get("name"):
            body = [f"# {person['name']}", ""]
            if person.get("role"):
                body.append(f"**{person['role']}** at {item.symbol} ({person.get('change', 'change')})")
            if person.get("bio"):
                body += ["", person["bio"]]
            for src in person.get("sources", []):
                body.append(f"- {src}")
            Brain(item.symbol).write_page("people", person["name"], "\n".join(body) + "\n",
                                          source=item.source_url)
        Brain(item.symbol).log(f"enriched {item.category}: {(a.summary or '')[:80]}")
        sent = send_pending(db)
    print(json.dumps({"ok": True, "updated": len(siblings), "pushed": sent}))
    return 0


def main(argv: list[str] | None = None) -> int:
    init_db()
    p = argparse.ArgumentParser(prog="finn")
    sub = p.add_subparsers(dest="cmd", required=True)

    o = sub.add_parser("onboard")
    o.add_argument("symbols", nargs="+")
    o.add_argument("--weights")
    o.add_argument("--days", type=int, default=30)
    o.set_defaults(fn=cmd_onboard)

    c = sub.add_parser("cron")
    csub = c.add_subparsers(dest="job", required=True)
    ca = csub.add_parser("announcements")
    ca.add_argument("--hours", type=int, default=12)
    ca.set_defaults(fn=cmd_cron_announcements)
    csub.add_parser("eod").set_defaults(fn=cmd_cron_eod)
    ci = csub.add_parser("ingest")
    ci.add_argument("--limit", type=int, default=10)
    ci.add_argument("--no-ocr", action="store_true", help="text layer only (no Chandra spend)")
    ci.set_defaults(fn=cmd_cron_ingest)

    e = sub.add_parser("enrich", help="agent write-back for a feed item")
    e.add_argument("feed_id")
    e.add_argument("--summary", help="one line, <=160 chars, what changed and why it matters")
    e.add_argument("--person", help='JSON: {"name","role","change","bio","sources":[...]}')
    e.add_argument("--importance", type=float, help="0-1: how much a holder should care")
    e.set_defaults(fn=cmd_enrich)

    t = sub.add_parser("pdftext")
    t.add_argument("url")
    t.add_argument("--pages", type=int, default=3)
    t.set_defaults(fn=cmd_pdftext)

    r = sub.add_parser("results")
    r.add_argument("symbol")
    r.set_defaults(fn=cmd_results)

    ra = sub.add_parser("reassess", help="run the materiality cascade over recent backfilled items")
    ra.add_argument("--days", type=int, default=14)
    ra.add_argument("--limit", type=int, default=60)
    ra.add_argument("--force", action="store_true", help="re-run even where a verdict exists")
    ra.set_defaults(fn=cmd_reassess)

    tk = sub.add_parser("token", help="mint an app token (JWT) for an app build")
    tk.add_argument("--sub", default="finn-app")
    tk.add_argument("--days", type=int, default=30)
    tk.set_defaults(fn=cmd_token)

    d = sub.add_parser("digest")
    d.add_argument("--hours", type=int, default=24)
    d.set_defaults(fn=cmd_digest)

    a = p.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    raise SystemExit(main())

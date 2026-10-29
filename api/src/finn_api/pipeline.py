"""Deterministic pipeline shared by onboarding and the cron scripts.

Nothing here calls an LLM. The crons run these, and only hand material items to
the Hermes agent for enrichment (person bios, one-liners) — see `cli.py`.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from finn_api.brain import Brain
from finn_api.models import FeedItem, Holding, User
from finn_api.results import results_card
from finn_api.signals import Thresholds, detect
from finn_api.sources import taxonomy
from finn_api.sources.nse import NSE

log = logging.getLogger("finn.pipeline")
IST = timedelta(hours=5, minutes=30)


def _event_time(ann: dict) -> datetime:
    raw = ann.get("sort_date") or ""
    try:
        return datetime.fromisoformat(raw).replace(tzinfo=UTC) - IST
    except ValueError:
        return datetime.now(UTC)


def _story_key(symbol: str, cat: taxonomy.Category, ann: dict, when: datetime) -> str:
    text = ann.get("attchmntText") or ""
    topic = cat.key
    if cat is taxonomy.INVESTOR and taxonomy._RESULTS_TEXT.search(text):
        topic = "results"  # press release / deck about results joins the results story
    return f"{symbol}:{topic}:{(when + IST).date().isoformat()}"


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def holdings_by_symbol(db: Session) -> dict[str, list[Holding]]:
    out: dict[str, list[Holding]] = {}
    for h in db.scalars(select(Holding)):
        out.setdefault(h.symbol, []).append(h)
    return out


# ── announcements ─────────────────────────────────────────────────────────


def ingest_announcements(
    db: Session,
    nse: NSE,
    rows: list[dict],
    *,
    backfill: bool = False,
) -> list[FeedItem]:
    """Classify, write to each company brain, and create feed items per holder.

    Returns the newly created feed items (callers decide what to push/enrich).
    """
    by_sym = holdings_by_symbol(db)
    created: list[FeedItem] = []
    for ann in rows:
        sym = (ann.get("symbol") or "").upper()
        holders = by_sym.get(sym)
        if not holders:
            continue
        text = _clean(ann.get("attchmntText", ""))
        cat = taxonomy.classify(ann.get("desc", ""), text)
        brain = Brain(sym)
        if not brain.exists:
            brain.scaffold(name=ann.get("sm_name"), industry=ann.get("smIndustry"))
        brain.append_filing(ann, cat.label, cat.tier)

        when = _event_time(ann)
        key = f"nse:{ann.get('seq_id')}"
        story = _story_key(sym, cat, ann, when)
        for h in holders:
            exists = db.scalar(
                select(FeedItem.id).where(FeedItem.user_id == h.user_id, FeedItem.dedup_key == key)
            )
            if exists:
                continue
            item = FeedItem(
                user_id=h.user_id,
                symbol=sym,
                kind="filing",
                category=cat.key,
                tier=cat.tier,
                score=base_score(cat.tier, h.weight),
                title=f"{ann.get('desc', 'Filing')}",
                summary=text[:400] or None,
                payload_json=json.dumps({"desc": ann.get("desc"), "company": ann.get("sm_name"),
                                         "category_label": cat.label}),
                source_url=ann.get("attchmntFile") or None,
                dedup_key=key,
                story_key=story,
                event_at=when,
                # Backfilled history is context, not news: never push it.
                pushed_at=datetime.now(UTC) if backfill else None,
                seen=backfill,
            )
            db.add(item)
            created.append(item)
    db.commit()
    for item in created:
        if item.category == "results":
            attach_results_card(db, nse, item)
    return created


def base_score(tier: int, weight: float) -> float:
    """Materiality before freshness: category tier dominates, position size breaks ties."""
    return round(tier * 10 + min(weight, 20) / 2, 2)


def attach_results_card(db: Session, nse: NSE, item: FeedItem) -> bool:
    """Results filing → QoQ/YoY card from XBRL. Leaves `pending` if XBRL isn't out yet."""
    payload = json.loads(item.payload_json or "{}")
    try:
        card = results_card(nse, item.symbol)
    except Exception as e:  # NSE hiccup — retried on the next tick
        log.warning("results card %s failed: %s", item.symbol, e)
        card = None
    fresh = bool(card) and (
        item.event_at.date() - date.fromisoformat(card["period_end"])
    ) <= timedelta(days=75)
    if not fresh:
        payload["results_pending"] = True
        item.payload_json = json.dumps(payload)
        db.commit()
        return False
    payload.pop("results_pending", None)
    payload["results"] = card
    item.payload_json = json.dumps(payload)
    item.kind = "results"
    item.title = f"Q results · {quarter_label(card['period_end'])}"
    rev = card["rows"][0]
    pat = card["rows"][3]
    item.summary = (
        f"{rev['label']} {fmt_pct(rev['yoy_pct'])} YoY, PAT {fmt_pct(pat['yoy_pct'])} YoY"
        + (f" · {card['flags'][0]}" if card.get("flags") else "")
    )
    item.source_url = card["source"]["xbrl"]
    db.commit()
    write_results_page(Brain(item.symbol), card)
    return True


def retry_pending_results(db: Session, nse: NSE) -> int:
    n = 0
    for item in db.scalars(select(FeedItem).where(FeedItem.category == "results", FeedItem.kind == "filing")):
        if json.loads(item.payload_json or "{}").get("results_pending") and attach_results_card(db, nse, item):
            n += 1
    return n


def quarter_label(period_end: str) -> str:
    d = date.fromisoformat(period_end)
    fy = d.year + 1 if d.month > 3 else d.year
    q = {6: 1, 9: 2, 12: 3, 3: 4}.get(d.month, 0)
    return f"Q{q} FY{fy % 100:02d}"


def fmt_pct(v: float | None) -> str:
    return "n/a" if v is None else f"{v:+.1f}%"


def write_results_page(brain: Brain, card: dict) -> None:
    label = quarter_label(card["period_end"])
    lines = [
        f"# {brain.symbol} {label} results ({'consolidated' if card['consolidated'] else 'standalone'})",
        "",
        "| ₹ Cr | This quarter | Prev quarter | QoQ | Year ago | YoY |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for r in card["rows"]:
        def n(v):
            return "—" if v is None else f"{v:,.0f}"
        lines.append(
            f"| {r['label']} | {n(r['value'])} | {n(r['prev_q'])} | {fmt_pct(r['qoq_pct'])} "
            f"| {n(r['year_ago'])} | {fmt_pct(r['yoy_pct'])} |"
        )
    if card.get("ebitda_margin_pct") is not None:
        lines += ["", f"EBITDA margin: {card['ebitda_margin_pct']}%"]
    for f in card.get("flags", []):
        lines.append(f"- ⚠ {f}")
    brain.write_page("results", card["period_end"], "\n".join(lines) + "\n", source=card["source"]["xbrl"])


# ── EOD ───────────────────────────────────────────────────────────────────


def run_eod(db: Session, nse: NSE, *, day: date | None = None) -> list[FeedItem]:
    days = nse.recent_bhavcopies(21, until=day)
    if not days:
        return []
    trade_day = next(iter(days[-1].values())).day
    created = []
    for user in db.scalars(select(User)):
        syms = [h.symbol for h in db.scalars(select(Holding).where(Holding.user_id == user.id))]
        t = Thresholds(**json.loads(user.thresholds_json or "{}"))
        for sig in detect(syms, days, t):
            key = f"eod:{trade_day}:{sig.symbol}:{sig.kind}"
            if db.scalar(select(FeedItem.id).where(FeedItem.user_id == user.id, FeedItem.dedup_key == key)):
                continue
            item = FeedItem(
                user_id=user.id,
                symbol=sig.symbol,
                kind="signal",
                category=f"signal_{sig.kind}",
                tier=taxonomy.ALERT,
                score=base_score(taxonomy.ALERT, 0) + min(abs(sig.value), 20),
                title=sig.headline,
                payload_json=json.dumps({
                    "kind": sig.kind, "value": sig.value, "threshold": sig.threshold,
                    "close": sig.bar.close, "prev_close": sig.bar.prev_close,
                    "volume": sig.bar.volume, "change_pct": sig.bar.change_pct,
                    "day": trade_day.isoformat(),
                }),
                dedup_key=key,
                story_key=f"{sig.symbol}:move:{trade_day}",
                event_at=datetime.combine(trade_day, datetime.min.time(), UTC) + timedelta(hours=10),
            )
            db.add(item)
            created.append(item)
    db.commit()
    return created


# ── onboarding ────────────────────────────────────────────────────────────


def onboard(
    db: Session,
    nse: NSE,
    user: User,
    symbols: list[str],
    *,
    weights: dict[str, float] | None = None,
    backfill_days: int = 30,
) -> dict:
    """Add holdings, scaffold brains, backfill recent filings and the latest results."""
    report: dict[str, dict] = {}
    end = date.today()
    for raw in symbols:
        sym = raw.strip().upper()
        if not sym:
            continue
        rows = nse.announcements(symbol=sym, start=end - timedelta(days=backfill_days), end=end)
        name = rows[0].get("sm_name") if rows else None
        industry = rows[0].get("smIndustry") if rows else None
        holding = db.scalar(select(Holding).where(Holding.user_id == user.id, Holding.symbol == sym))
        if holding is None:
            holding = Holding(user_id=user.id, symbol=sym)
            db.add(holding)
        holding.name, holding.industry = name or holding.name, industry or holding.industry
        holding.weight = (weights or {}).get(sym, holding.weight)
        db.commit()

        brain = Brain(sym)
        created = brain.scaffold(name=name, industry=industry)
        items = ingest_announcements(db, nse, rows, backfill=True)
        card = None
        try:
            card = results_card(nse, sym)
        except Exception as e:
            log.warning("onboard %s results failed: %s", sym, e)
        if card:
            write_results_page(brain, card)
        brain.log(f"onboarded: {len(rows)} filings ({backfill_days}d), results {card and card['period_end']}")
        report[sym] = {
            "name": name,
            "filings": len(rows),
            "new_feed_items": len(items),
            "latest_results": card and card["period_end"],
            "scaffolded": created,
        }
    return report

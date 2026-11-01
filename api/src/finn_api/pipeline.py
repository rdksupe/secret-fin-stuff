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
    assess_materiality: bool = True,
) -> list[FeedItem]:
    """Classify, write to each company brain, and create feed items per holder.

    Live (non-backfill) filings that the rules can't settle go through the
    materiality cascade; a "push" verdict promotes them to an alert.
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
        fresh = [h for h in holders if not db.scalar(
            select(FeedItem.id).where(FeedItem.user_id == h.user_id, FeedItem.dedup_key == key))]
        if not fresh:
            continue
        verdict = None
        if assess_materiality and not backfill and cat.key in CASCADE:
            verdict = assess_filing(db, nse, ann, rule_tier=cat.tier)
        for h in fresh:
            tier, summary = cat.tier, text[:400] or None
            extra: dict = {}
            if verdict is not None:
                extra["materiality"] = verdict.as_dict()
                if verdict.llm and verdict.llm.get("one_liner"):
                    summary = verdict.llm["one_liner"]
                    extra["raw_text"] = text[:400]
                tier = tier_from_verdict(cat.tier, verdict)
                if verdict.push and (verdict.llm or {}).get("direction", "negative") == "negative":
                    story = f"{sym}:situation:{(when + IST).date().isoformat()}"
            item = FeedItem(
                user_id=h.user_id,
                symbol=sym,
                kind="filing",
                category=cat.key,
                tier=tier,
                score=base_score(tier, h.weight),
                title=f"{ann.get('desc', 'Filing')}",
                summary=summary,
                payload_json=json.dumps({"desc": ann.get("desc"), "company": ann.get("sm_name"),
                                         "category_label": cat.label} | extra, ensure_ascii=False),
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


# Rules can't judge these on their own: generic buckets, press releases, legal,
# ratings, business updates. Routine, results and management are settled by rules
# (management still gets the agent's bio enrichment).
CASCADE = {"other", "investor", "business", "legal", "rating", "orders", "mna", "capital", "governance", "auditor",
           "distress"}  # insolvency filings are often about a counterparty, not the company


def tier_from_verdict(rule_tier: int, verdict) -> int:
    """Promote on a push. Demote only what Jev is confident is routine paperwork, or what the
    LLM read in full and called immaterial; otherwise the rule tier stands."""
    if verdict.push:
        return taxonomy.ALERT
    if verdict.nouls.get("routine", 0) >= 0.7:
        return min(rule_tier, taxonomy.LIST)
    if verdict.verdict == "not_material":
        # The LLM read it in full: low importance goes on file, the rest stays worth a look.
        low = float((verdict.llm or {}).get("importance", 0.5)) < 0.3
        return min(rule_tier, taxonomy.LIST if low else taxonomy.BRIEF)
    return rule_tier


def reassess_recent(db: Session, nse: NSE, *, days: int = 14, limit: int = 60, force: bool = False) -> list[FeedItem]:
    """Run the cascade over recent items that predate it (backfill) — fixes stub headlines
    and mis-tiered filings. One assessment per filing, applied to every holder's copy."""
    since = datetime.now(UTC) - timedelta(days=days)
    items = db.scalars(select(FeedItem).where(
        FeedItem.kind == "filing", FeedItem.event_at >= since, FeedItem.category.in_(CASCADE),
    ).order_by(FeedItem.event_at.desc())).all()
    by_key: dict[str, list[FeedItem]] = {}
    for it in items:
        if force or "materiality" not in json.loads(it.payload_json or "{}"):
            by_key.setdefault(it.dedup_key, []).append(it)
    done = []
    for _key, copies in list(by_key.items())[:limit]:
        it = copies[0]
        p = json.loads(it.payload_json or "{}")
        cat = taxonomy.classify(p.get("desc") or "", p.get("raw_text") or it.summary or "")
        ann = {"symbol": it.symbol, "sm_name": p.get("company"), "desc": p.get("desc"),
               "attchmntText": p.get("raw_text") or it.summary or "", "attchmntFile": it.source_url}
        v = assess_filing(db, nse, ann, rule_tier=cat.tier)
        for c in copies:
            cp = json.loads(c.payload_json or "{}")
            cp["materiality"] = v.as_dict()
            if v.llm and v.llm.get("one_liner"):
                cp["raw_text"] = cp.get("raw_text") or c.summary
                c.summary = v.llm["one_liner"]
            c.payload_json = json.dumps(cp, ensure_ascii=False)
            c.tier = tier_from_verdict(cat.tier, v)
            c.score = base_score(c.tier, 0)
        db.commit()
        done.append(it)
    return done


def assess_filing(db: Session, nse: NSE, ann: dict, *, rule_tier: int = taxonomy.LIST):
    from finn_api import materiality

    raw = None
    if ann.get("attchmntFile"):
        try:
            raw = nse.get_archive(ann["attchmntFile"])
        except Exception as e:
            log.info("no pdf for %s: %s", ann.get("symbol"), e)
    a = materiality.assess(ann, raw, db=db, want_summary=rule_tier >= taxonomy.BRIEF)
    db.commit()
    return a


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
        by_sym: dict[str, list] = {}
        for sig in detect(syms, days, t):
            by_sym.setdefault(sig.symbol, []).append(sig)
        # One move per stock per day: price and volume breaches merge into a single item.
        for sym, sigs in by_sym.items():
            key = f"eod:{trade_day}:{sym}"
            if db.scalar(select(FeedItem.id).where(FeedItem.user_id == user.id, FeedItem.dedup_key == key)):
                continue
            bar = sigs[0].bar
            vol = next((s.value for s in sigs if s.kind == "volume"), None)
            title = f"{sym} {bar.change_pct:+.1f}%" + (f", volume {vol:.1f}× avg" if vol else "")
            summary = (f"Closed ₹{bar.close:,.2f} vs ₹{bar.prev_close:,.2f}"
                       + (f"; {bar.volume:,} shares traded" if vol else "")
                       + f". Crossed your {' and '.join(sorted({s.kind for s in sigs}))} threshold.")
            item = FeedItem(
                user_id=user.id,
                symbol=sym,
                kind="signal",
                category="signal_move",
                tier=taxonomy.ALERT,
                score=base_score(taxonomy.ALERT, 0) + min(abs(bar.change_pct), 20) + min(vol or 0, 10),
                title=title,
                summary=summary,
                payload_json=json.dumps({
                    "kinds": [s.kind for s in sigs], "volume_x": vol,
                    "thresholds": {s.kind: s.threshold for s in sigs},
                    "close": bar.close, "prev_close": bar.prev_close,
                    "volume": bar.volume, "change_pct": bar.change_pct,
                    "day": trade_day.isoformat(),
                }),
                dedup_key=key,
                story_key=f"{sym}:situation:{trade_day}",
                event_at=datetime.combine(trade_day, datetime.min.time(), UTC) + timedelta(hours=10),
            )
            db.add(item)
            created.append(item)
            escalate_explaining_filings(db, item, trade_day)
    db.commit()
    return created


def escalate_explaining_filings(db: Session, signal: FeedItem, trade_day: date) -> list[FeedItem]:
    """Filings from the move day or the day before join the move's story and become alerts."""
    start = datetime.combine(trade_day - timedelta(days=1), datetime.min.time(), UTC) - IST
    end = datetime.combine(trade_day + timedelta(days=1), datetime.min.time(), UTC) - IST
    filings = db.scalars(select(FeedItem).where(
        FeedItem.user_id == signal.user_id, FeedItem.symbol == signal.symbol, FeedItem.kind != "signal",
        FeedItem.tier >= taxonomy.LIST, FeedItem.event_at >= start, FeedItem.event_at < end,
    )).all()
    for f in filings:
        payload = json.loads(f.payload_json or "{}")
        payload["moved_with"] = signal.title
        f.payload_json = json.dumps(payload, ensure_ascii=False)
        f.tier = taxonomy.ALERT
        f.story_key = signal.story_key
    return list(filings)


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
    from finn_api import portfolio_context

    portfolio_context.write(db)
    return report

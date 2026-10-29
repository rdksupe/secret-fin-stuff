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


def cmd_digest(a: argparse.Namespace) -> int:
    from finn_api.digest import build_digest

    with SessionLocal() as db:
        d = build_digest(db, _default_user(db).id, hours=a.hours)
    print(json.dumps(d, indent=2, default=str, ensure_ascii=False))
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
    ca.add_argument("--hours", type=int, default=2)
    ca.set_defaults(fn=cmd_cron_announcements)
    csub.add_parser("eod").set_defaults(fn=cmd_cron_eod)

    d = sub.add_parser("digest")
    d.add_argument("--hours", type=int, default=24)
    d.set_defaults(fn=cmd_digest)

    a = p.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    raise SystemExit(main())

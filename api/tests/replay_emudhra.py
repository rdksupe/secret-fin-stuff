# Manual replay (hits NSE, Jev, Fireworks). Run with a scratch DB:
#   FINN_DB_PATH=/tmp/r/finn.db FINN_KB_DIR=/tmp/r/kb uv run python tests/replay_emudhra.py
"""Replay EMUDHRA 20–28 Oct 2026 through the live pipeline in a scratch DB/KB."""
import json
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select

from finn_api.db import SessionLocal, init_db
from finn_api.digest import build_digest
from finn_api.models import FeedItem, Holding, LLMCall, User
from finn_api.pipeline import ingest_announcements, run_eod
from finn_api.push import should_push
from finn_api.sources.nse import NSE

init_db(); db = SessionLocal(); nse = NSE()
user = User(name="Replay"); db.add(user); db.commit()
db.add(Holding(user_id=user.id, symbol="EMUDHRA", name="eMudhra Limited", weight=4)); db.commit()
rows = nse.announcements(symbol="EMUDHRA", start=date(2026, 9, 1), end=date(2026, 10, 29))
rows.sort(key=lambda r: r["sort_date"])
ist = lambda r: datetime.fromisoformat(r["sort_date"])
ingest_announcements(db, nse, [r for r in rows if ist(r) < datetime(2026, 10, 20)], backfill=True)

def flush(now: str):
    for i in db.scalars(select(FeedItem).where(FeedItem.pushed_at.is_(None))):
        if should_push(user, i):
            print(f"  📲 PUSH @ {now}  [{i.kind}/{i.category}] {i.title[:50]} — {(i.summary or '')[:150]}")
            i.pushed_at = datetime.now(UTC)
    db.commit()

live = [r for r in rows if ist(r) >= datetime(2026, 10, 20)]
day = date(2026, 10, 20)
while day <= date(2026, 10, 28):
    for r in [r for r in live if ist(r).date() == day]:
        print(f"{r['sort_date'][:16]} IST  {r['desc'][:40]} | {r['attchmntText'][38:120]}")
        for it in ingest_announcements(db, nse, [r]):
            m = json.loads(it.payload_json).get("materiality")
            if m:
                llm = {k: m['llm'][k] for k in ('importance', 'direction', 'push_now')} if m.get('llm') else None
                print(f"    cascade: stage={m['stage']} verdict={m['verdict']} jev={m['score']} llm={llm} push={m['push']}")
        flush(r["sort_date"][11:16])
    if day.weekday() < 5:
        for s_ in run_eod(db, nse, day=day):
            if json.loads(s_.payload_json)["day"] == day.isoformat():
                print(f"{day} 18:30 IST  EOD signal: {s_.title}")
        flush("18:30")
    day += timedelta(days=1)

print("\n=== Digest 20–29 Oct")
d = build_digest(db, user.id, since=datetime(2026, 10, 19, 18, 30, tzinfo=UTC), until=datetime(2026, 10, 29, tzinfo=UTC))
print(d["counts"])
for b in ("alert", "brief", "list"):
    for s_ in d[b]:
        print(f"[{b}] {s_['story_key']} situation={s_.get('situation', False)} cumulative={s_.get('cumulative_pct')}% ({s_.get('from_close')} → {s_.get('to_close')})")
        print(f"   HEAD: {s_['head']['title']} — {(s_['head']['summary'] or '')[:140]}")
        for t in s_.get("timeline", []):
            print(f"     {t['at'][:16]}  {t['kind']:7} {t['title'][:45]}")
cost = db.execute(select(LLMCall.feature, LLMCall.model, LLMCall.input_tokens, LLMCall.output_tokens, LLMCall.cost_usd)).all()
print("\ncalls:", len(cost), "| jev $", round(sum(c[4] for c in cost), 5),
      "| fireworks tokens in/out", sum(c[2] for c in cost if c[0] == "materiality_llm"), sum(c[3] for c in cost if c[0] == "materiality_llm"))

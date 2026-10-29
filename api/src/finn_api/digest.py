"""Windowed digest: every filing/signal across the portfolio in a chosen window,
grouped into stories, ranked by materiality, routine collapsed.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from finn_api.models import FeedItem
from finn_api.sources.taxonomy import ALERT, BRIEF, LIST, ROUTINE


def _item(i: FeedItem) -> dict:
    return {
        "id": i.id,
        "symbol": i.symbol,
        "kind": i.kind,
        "category": i.category,
        "tier": i.tier,
        "title": i.title,
        "summary": i.summary,
        "payload": json.loads(i.payload_json or "{}"),
        "source_url": i.source_url,
        "event_at": i.event_at.replace(tzinfo=i.event_at.tzinfo or UTC).isoformat(),
        "seen": i.seen,
    }


MERGE_WINDOW = timedelta(hours=72)


def cluster(items: list[FeedItem]) -> dict[str, list[FeedItem]]:
    """Same company + same topic within 72h = one story (e.g. CEO resigns, then successor named)."""
    stories: dict[str, list[FeedItem]] = {}
    open_: dict[str, tuple[str, datetime]] = {}  # "SYM:topic" → (story key, latest event)
    for i in sorted(items, key=lambda i: i.event_at):
        sk = i.story_key or i.id
        sym, _, rest = sk.partition(":")
        topic = rest.rsplit(":", 1)[0] if rest else i.id
        bucket = f"{sym}:{topic}"
        prev = open_.get(bucket)
        key = prev[0] if prev and i.event_at - prev[1] <= MERGE_WINDOW else sk
        stories.setdefault(key, []).append(i)
        open_[bucket] = (key, i.event_at)
    return stories


def _freshness(event_at: datetime, now: datetime) -> float:
    """1.0 now → 0.5 at 24h → 0.25 at 48h."""
    hours = max((now - event_at).total_seconds() / 3600, 0)
    return 0.5 ** (hours / 24)


def build_digest(
    db: Session,
    user_id: str,
    *,
    hours: int = 24,
    since: datetime | None = None,
    until: datetime | None = None,
    include_dismissed: bool = False,
) -> dict:
    until = until or datetime.now(UTC)
    since = since or until - timedelta(hours=hours)
    q = select(FeedItem).where(
        FeedItem.user_id == user_id, FeedItem.event_at >= since, FeedItem.event_at <= until
    )
    if not include_dismissed:
        q = q.where(FeedItem.dismissed.is_(False))
    items = list(db.scalars(q))

    stories = cluster(items)

    ranked = []
    routine: dict[str, list[dict]] = defaultdict(list)
    for key, group in stories.items():
        group.sort(key=lambda i: (i.tier, i.kind == "results", i.event_at), reverse=True)
        head = group[0]
        when = max(g.event_at for g in group).replace(tzinfo=UTC)
        if head.tier == ROUTINE:
            for g in group:
                routine[g.symbol].append(_item(g))
            continue
        score = head.score * (0.5 + _freshness(when, until))
        ranked.append(
            {
                "story_key": key,
                "symbol": head.symbol,
                "tier": head.tier,
                "score": round(score, 2),
                "head": _item(head),
                "related": [_item(g) for g in group[1:]],
                "event_at": when.isoformat(),
            }
        )
    ranked.sort(key=lambda s: s["score"], reverse=True)

    def bucket(tier: int) -> list[dict]:
        return [s for s in ranked if s["tier"] == tier]

    routine_count = sum(len(v) for v in routine.values())
    return {
        "window": {"since": since.isoformat(), "until": until.isoformat()},
        "counts": {
            "alert": len(bucket(ALERT)),
            "brief": len(bucket(BRIEF)),
            "list": len(bucket(LIST)),
            "routine": routine_count,
            "filings": len(items),
        },
        "alert": bucket(ALERT),
        "brief": bucket(BRIEF),
        "list": bucket(LIST),
        "routine": {sym: v for sym, v in sorted(routine.items())},
    }

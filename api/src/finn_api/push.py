"""Push alert-tier feed items to the user's phone via the Expo Push API (no key needed)."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from finn_api.models import FeedItem, User
from finn_api.sources.taxonomy import ALERT

log = logging.getLogger("finn.push")
EXPO_URL = "https://exp.host/--/api/v2/push/send"
ENRICH_GRACE = timedelta(minutes=20)


def should_push(user: User, item: FeedItem) -> bool:
    if item.pushed_at or item.seen or item.tier < ALERT:
        return False
    if item.kind == "signal":
        return True
    payload = json.loads(item.payload_json or "{}")
    if payload.get("results_pending"):
        return False  # wait for the numbers; a bare "results filed" ping is noise
    if payload.get("enrich_pending"):
        # Hold for the agent's bio / one-liner, but never longer than 20 minutes.
        created = item.created_at.replace(tzinfo=item.created_at.tzinfo or UTC)
        if datetime.now(UTC) - created < ENRICH_GRACE:
            return False
    if (payload.get("materiality") or {}).get("push"):
        return True  # cascade judged it material regardless of its filing category
    if payload.get("moved_with"):
        return True  # filing that explains an unusual price move
    return item.category in set(json.loads(user.alert_categories_json or "[]"))


def message(item: FeedItem) -> tuple[str, str]:
    title = f"{item.symbol} · {item.title}"
    body = item.summary or ""
    return title[:120], body[:240]


def send_pending(db: Session, client: httpx.Client | None = None) -> int:
    """Push every unpushed alert. Native app tokens are stored as `fcm:<token>` and go out via
    FCM; legacy Expo tokens via the Expo push API. Marks items pushed even with no device."""
    from finn_api import fcm

    client = client or httpx.Client(timeout=15)
    sent = 0
    for user in db.scalars(select(User)):
        all_tokens = json.loads(user.push_tokens_json or "[]")
        fcm_tokens = [t[4:] for t in all_tokens if t.startswith("fcm:")]
        tokens = [t for t in all_tokens if not t.startswith("fcm:")]
        items = [
            i for i in db.scalars(select(FeedItem).where(FeedItem.user_id == user.id, FeedItem.pushed_at.is_(None)))
            if should_push(user, i)
        ]
        if not items:
            continue
        if fcm_tokens and fcm.available():
            gone = set()
            for item in items:
                title, body = message(item)
                for t in fcm_tokens:
                    res = fcm.send(t, title, body, {"feed_id": item.id, "symbol": item.symbol}, client)
                    sent += res == "ok"
                    if res == "gone":
                        gone.add(f"fcm:{t}")
            if gone:
                user.push_tokens_json = json.dumps([t for t in all_tokens if t not in gone])
        messages = []
        for item in items:
            title, body = message(item)
            messages += [
                {"to": t, "title": title, "body": body, "sound": "default",
                 "data": {"feed_id": item.id, "symbol": item.symbol}}
                for t in tokens
            ]
        if messages:
            try:
                r = client.post(EXPO_URL, json=messages)
                r.raise_for_status()
                sent += len(messages)
            except httpx.HTTPError as e:
                log.warning("expo push failed: %s", e)
                continue  # retry next tick
        now = datetime.now(UTC)
        for item in items:
            item.pushed_at = now
        db.commit()
    return sent

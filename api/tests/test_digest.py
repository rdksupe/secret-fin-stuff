from datetime import UTC, datetime, timedelta

from finn_api.digest import cluster
from finn_api.models import FeedItem


def item(key, hours):
    return FeedItem(id=key + str(hours), story_key=key,
                    event_at=datetime(2026, 10, 20, tzinfo=UTC) + timedelta(hours=hours))


def test_cluster_merges_same_topic_within_72h():
    s = cluster([
        item("HDFCBANK:management:2026-10-20", 0),
        item("HDFCBANK:management:2026-10-21", 30),
        item("HDFCBANK:management:2026-10-28", 200),  # a separate, later story
        item("HDFCBANK:results:2026-10-20", 1),
    ])
    sizes = sorted(len(v) for v in s.values())
    assert sizes == [1, 1, 2]


def test_push_holds_items_awaiting_enrichment():
    import json

    from finn_api.models import User
    from finn_api.push import should_push

    user = User(alert_categories_json='["management"]')
    now = datetime.now(UTC)
    fresh = FeedItem(tier=3, kind="filing", category="management", seen=False, pushed_at=None,
                     created_at=now, payload_json=json.dumps({"enrich_pending": True}))
    assert not should_push(user, fresh)
    stale = FeedItem(tier=3, kind="filing", category="management", seen=False, pushed_at=None,
                     created_at=now - timedelta(minutes=25), payload_json=json.dumps({"enrich_pending": True}))
    assert should_push(user, stale)
    done = FeedItem(tier=3, kind="filing", category="management", seen=False, pushed_at=None,
                    created_at=now, payload_json="{}")
    assert should_push(user, done)


def test_situation_stays_one_story_for_ten_days():
    s = cluster([
        item("EMUDHRA:situation:2026-10-21", 0),
        item("EMUDHRA:situation:2026-10-22", 30),
        item("EMUDHRA:situation:2026-10-26", 130),
        item("EMUDHRA:rating:2026-10-23", 50),
    ])
    assert sorted(len(v) for v in s.values()) == [1, 3]

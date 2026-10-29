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

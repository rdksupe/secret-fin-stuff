import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from finn_api.db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(UTC)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String, nullable=False, default="Investor")
    # Expo push token(s), JSON list. Telegram chat id kept for the optional mirror.
    push_tokens_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    telegram_chat_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # signals.Thresholds as JSON, plus the announcement categories that should push.
    thresholds_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    alert_categories_json: Mapped[str] = mapped_column(
        Text, nullable=False, default='["results","management","mna","distress","rating","orders"]'
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Holding(Base):
    __tablename__ = "holdings"
    __table_args__ = (UniqueConstraint("user_id", "symbol"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    symbol: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    industry: Mapped[str | None] = mapped_column(String, nullable=True)
    weight: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)  # % of portfolio
    watch_only: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class FeedItem(Base):
    """Everything the app shows in Brief / Alerts. Crons write; the app reads."""

    __tablename__ = "feed"
    __table_args__ = (UniqueConstraint("user_id", "dedup_key"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    symbol: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False)  # filing | signal | results | person | digest
    category: Mapped[str] = mapped_column(String, nullable=False, default="other")
    tier: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    title: Mapped[str] = mapped_column(String, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    source_url: Mapped[str | None] = mapped_column(String, nullable=True)
    dedup_key: Mapped[str] = mapped_column(String, nullable=False)
    # Groups companions (press release, deck) under the main filing of the same story.
    story_key: Mapped[str | None] = mapped_column(String, nullable=True)
    event_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    pushed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    seen: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    dismissed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class LLMCall(Base):
    """Cost ledger — every model call, by feature. Shown in the covering note."""

    __tablename__ = "llm_calls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    feature: Mapped[str] = mapped_column(String, nullable=False)
    model: Mapped[str] = mapped_column(String, nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    cached: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

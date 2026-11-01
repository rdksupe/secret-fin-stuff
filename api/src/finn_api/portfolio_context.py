"""The investor's portfolio as markdown: served to the agent by the `finn_portfolio` tool
(always current, so a holding added mid-chat is seen at once) and kept at `kb/portfolio.md`
as a readable page, regenerated whenever holdings or thresholds change.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from finn_api.config import settings
from finn_api.models import Holding, User

log = logging.getLogger("finn.portfolio")


def render(db: Session) -> str:
    user = db.scalar(select(User).order_by(User.created_at))
    rows = db.scalars(select(Holding).where(Holding.user_id == user.id).order_by(Holding.weight.desc(),
                                                                                Holding.symbol)).all() if user else []
    t = {"volume_x": 2.0, "price_pct": 5.0, "overrides": {}} | json.loads((user and user.thresholds_json) or "{}")
    held = [h for h in rows if not h.watch_only]
    watch = [h for h in rows if h.watch_only]
    ist = (datetime.now(UTC) + timedelta(hours=5, minutes=30)).strftime("%d %b %Y %H:%M IST")

    def table(hs: list[Holding]) -> list[str]:
        out = ["| Symbol | Company | Industry | Weight |", "|---|---|---|---|"]
        out += [f"| {h.symbol} | {h.name or ''} | {h.industry or ''} | {f'{h.weight:g}%' if h.weight else '—'} |"
                for h in hs]
        return out

    lines = [
        "# Investor portfolio",
        "",
        f"The investor FINN works for holds these {len(held)} NSE companies (updated {ist}). "
        "\"My portfolio\", \"my companies\" and \"my stocks\" mean exactly this list. "
        "Each has a brain at `kb/companies/{SYMBOL}/wiki/`.",
        "",
        *table(held),
    ]
    if watch:
        lines += ["", f"Watching (not held): {', '.join(h.symbol for h in watch)}"]
    over = t.get("overrides") or {}
    lines += [
        "",
        "## Alert thresholds",
        f"- Volume: {t['volume_x']:g}× the 20-day average · Price: ±{t['price_pct']:g}% on the day",
        *[f"- {sym}: " + ", ".join(f"{k} {v}" for k, v in o.items()) for sym, o in over.items()],
        "",
        "Other brains under `kb/companies/` are companies the investor researched, not holdings.",
    ]
    return "\n".join(lines) + "\n"


def write(db: Session) -> None:
    try:
        (settings.finn_kb_dir / "portfolio.md").write_text(render(db), encoding="utf-8")
        # Earlier builds loaded the portfolio into the system prompt via .hermes.md, which went
        # stale within a session; the finn_portfolio tool replaced it.
        (settings.finn_kb_dir.parent / ".hermes.md").unlink(missing_ok=True)
    except Exception as e:  # never break a holdings change over this
        log.warning("portfolio context write failed: %s", e)

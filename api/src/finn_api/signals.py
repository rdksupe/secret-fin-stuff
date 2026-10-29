"""EOD unusual-move detection. Pure functions — the `eod` cron feeds it bhavcopies."""

from __future__ import annotations

from dataclasses import dataclass, field
from statistics import mean

from finn_api.sources.nse import Bar


@dataclass(frozen=True)
class Thresholds:
    """What "unusual" means to this user. Per-symbol overrides win."""

    volume_x: float = 2.0  # today's volume vs trailing average
    price_pct: float = 5.0  # absolute day move
    lookback: int = 20
    overrides: dict[str, dict] = field(default_factory=dict)

    def for_symbol(self, symbol: str) -> Thresholds:
        o = self.overrides.get(symbol)
        if not o:
            return self
        return Thresholds(
            volume_x=o.get("volume_x", self.volume_x),
            price_pct=o.get("price_pct", self.price_pct),
            lookback=self.lookback,
        )


@dataclass(frozen=True)
class Signal:
    symbol: str
    kind: str  # "volume" | "price"
    value: float  # volume multiple, or day % move
    threshold: float
    bar: Bar

    @property
    def headline(self) -> str:
        if self.kind == "volume":
            return f"{self.symbol} volume {self.value:.1f}× its recent average ({self.bar.change_pct:+.1f}%)"
        return f"{self.symbol} {self.value:+.1f}% today, close ₹{self.bar.close:,.2f}"


def volume_multiple(today: Bar, history: list[Bar]) -> float | None:
    vols = [b.volume for b in history if b.volume > 0 and b.day < today.day]
    if len(vols) < 5:
        return None
    avg = mean(vols)
    return round(today.volume / avg, 2) if avg else None


def detect(
    symbols: list[str],
    days: list[dict[str, Bar]],
    thresholds: Thresholds,
) -> list[Signal]:
    """`days` oldest → newest; the last one is the day being checked."""
    if not days:
        return []
    today, past = days[-1], days[:-1]
    out: list[Signal] = []
    for sym in symbols:
        bar = today.get(sym)
        if bar is None:
            continue
        t = thresholds.for_symbol(sym)
        history = [d[sym] for d in past[-t.lookback:] if sym in d]
        vx = volume_multiple(bar, history)
        if vx is not None and vx >= t.volume_x:
            out.append(Signal(sym, "volume", vx, t.volume_x, bar))
        if abs(bar.change_pct) >= t.price_pct:
            out.append(Signal(sym, "price", bar.change_pct, t.price_pct, bar))
    return out

from dataclasses import replace
from datetime import date, timedelta
from pathlib import Path

from finn_api.signals import Thresholds, detect, volume_multiple
from finn_api.sources.nse import parse_bhavcopy

FIX = Path(__file__).parent / "fixtures"


def real_day():
    return parse_bhavcopy((FIX / "bhavcopy_20261028.csv").read_text())


def test_parse_real_bhavcopy():
    bars = real_day()
    tcs = bars["TCS"]
    assert tcs.close == 2460.00 and tcs.prev_close == 2496.90
    assert tcs.volume == 2540047
    assert tcs.change_pct == -1.48


def history(bar, vols):
    return [replace(bar, day=bar.day - timedelta(days=i + 1), volume=v) for i, v in enumerate(vols)]


def test_volume_multiple_ignores_today_and_needs_history():
    tcs = real_day()["TCS"]
    assert volume_multiple(tcs, history(tcs, [1_000_000] * 3)) is None
    assert volume_multiple(tcs, history(tcs, [1_000_000] * 20)) == 2.54


def test_detect_with_user_thresholds_and_overrides():
    today = real_day()
    past = []
    for i in range(20, 0, -1):
        d = date(2026, 10, 28) - timedelta(days=i)
        past.append({s: replace(b, day=d, volume=1_000_000) for s, b in today.items()})
    days = [*past, today]

    # RELIANCE fell 3.2% on the day; HDFCBANK traded 28.5× the fake average.
    sig = detect(["TCS", "RELIANCE", "HDFCBANK"], days, Thresholds(volume_x=10, price_pct=3))
    kinds = {(s.symbol, s.kind) for s in sig}
    assert ("RELIANCE", "price") in kinds
    assert ("HDFCBANK", "volume") in kinds
    assert ("TCS", "price") not in kinds

    quiet = Thresholds(volume_x=10, price_pct=3, overrides={"RELIANCE": {"price_pct": 5}})
    assert ("RELIANCE", "price") not in {(s.symbol, s.kind) for s in detect(["RELIANCE"], days, quiet)}

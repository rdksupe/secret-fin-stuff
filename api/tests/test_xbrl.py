from datetime import date
from pathlib import Path

from finn_api.sources.xbrl import compare, parse_headline

FIX = Path(__file__).parent / "fixtures"


def load(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8", errors="ignore")


def test_integrated_filing_tcs_q2fy27():
    h = parse_headline(load("tcs_q2fy27_consolidated.xml"))
    assert h.symbol == "TCS"
    assert (h.period_start, h.period_end) == (date(2026, 7, 1), date(2026, 9, 30))
    assert h.consolidated and not h.is_bank
    assert h.revenue == 73188.0
    assert h.pbt == 18638.0
    assert h.pat == 13884.0  # attributable to owners, not 13,934 incl. minorities
    # 18,638 + 252 + 1,262 − 1,337
    assert h.ebitda == 18815.0


def test_legacy_filing_tcs_q3fy25():
    h = parse_headline(load("tcs_q3fy25_consolidated.xml"))
    assert h.period_end == date(2024, 12, 31)
    assert h.revenue == 63973.0
    assert h.pbt == 16666.0


def test_bank_uses_nii_and_ppop():
    h = parse_headline(load("hdfcbank_q2fy27_consolidated.xml"))
    assert h.is_bank
    assert h.labels == ("NII", "PPOP", "PBT", "PAT")
    assert h.revenue == round((951316300000 - 506674300000) / 1e7, 2)
    assert h.ebitda == 32871.54
    assert h.pat == 20700.03


def test_compare_qoq_yoy():
    now = parse_headline(load("tcs_q2fy27_consolidated.xml"))
    old = parse_headline(load("tcs_q3fy25_consolidated.xml"))
    card = compare(now, prev_q=old, year_ago=None)
    rev = card["rows"][0]
    assert rev["label"] == "Revenue"
    assert rev["qoq_pct"] == round((73188 - 63973) / 63973 * 100, 1)
    assert rev["yoy_pct"] is None
    assert card["ebitda_margin_pct"] == round(18815 / 73188 * 100, 1)


def test_flags_non_operating_profit():
    h = parse_headline(load("tcs_q2fy27_consolidated.xml"))
    from dataclasses import replace
    heavy = replace(h, other_income=h.pbt * 0.6)
    assert compare(heavy, None, None)["flags"][0].startswith("Other income")
    assert compare(h, None, None)["flags"] == []

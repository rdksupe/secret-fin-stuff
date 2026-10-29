import json
from collections import Counter
from pathlib import Path

from finn_api.sources.taxonomy import ALERT, ROUTINE, classify

FIX = Path(__file__).parent / "fixtures"


def test_exact_desc():
    assert classify("Change in Management").key == "management"
    assert classify("Copy of Newspaper Publication").tier == ROUTINE
    assert classify("Integrated Filing- Financial").tier == ALERT


def test_generic_bucket_uses_text():
    results = classify(
        "Outcome of Board Meeting",
        "approved the Unaudited Financial Results for the quarter ended September 30, 2026",
    )
    assert results.key == "results"
    order = classify("General Updates", "has received a Letter of Award worth Rs 412 crore")
    assert order.key == "orders"
    assert classify("Outcome of Board Meeting", "approved the minutes").key == "governance"


def test_results_companions_are_not_results():
    text = "Press release for Unaudited Financial Results for the quarter ended September 30, 2026"
    assert classify("Press Release", text).key == "investor"
    assert classify("General Updates", "Investor Presentation on Financial Results").key == "investor"


def test_real_week_mostly_quiet():
    rows = json.loads((FIX / "nse_announcements_week.json").read_text())
    tiers = Counter(classify(r["desc"], r.get("attchmntText", "")).tier for r in rows)
    # Even in results season, most filings should never ping anyone.
    assert (tiers[ROUTINE] + tiers[1]) / len(rows) > 0.6
    assert tiers[ALERT] / len(rows) < 0.3

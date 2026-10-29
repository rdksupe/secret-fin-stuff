"""Results card: latest quarter vs previous quarter (QoQ) and same quarter last year (YoY).

All three come from NSE XBRL filings — exact reported numbers, no OCR, no LLM.
"""

from __future__ import annotations

from datetime import date

from finn_api.sources.nse import NSE
from finn_api.sources.xbrl import Headline, compare, parse_headline


def _quarter_back(d: date, n: int) -> tuple[int, int]:
    m = d.year * 12 + d.month - 1 - 3 * n
    return m // 12, m % 12 + 1


def results_card(nse: NSE, symbol: str, *, period_end: date | None = None) -> dict | None:
    filings = nse.results_filings(symbol, consolidated=True) or nse.results_filings(
        symbol, consolidated=False
    )
    if not filings:
        return None
    by_month = {(f["period_end"].year, f["period_end"].month): f for f in filings}
    current = next((f for f in filings if f["period_end"] == period_end), None) if period_end else filings[0]
    if current is None:
        return None

    def load(f: dict | None) -> Headline | None:
        if not f:
            return None
        try:
            return parse_headline(nse.xbrl(f["xbrl"]))
        except ValueError:
            return None

    now = load(current)
    if now is None:
        return None
    prev = load(by_month.get(_quarter_back(current["period_end"], 1)))
    year_ago = load(by_month.get(_quarter_back(current["period_end"], 4)))
    card = compare(now, prev, year_ago)
    card["symbol"] = symbol.upper()
    card["source"] = {"xbrl": current["xbrl"], "filed": current["filed"]}
    return card

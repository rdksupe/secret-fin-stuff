"""Headline numbers from NSE results XBRL (legacy `in-bse-fin` and Integrated Filing `in-capmkt`).

Results filings are machine-readable, so the results card never needs OCR:
Revenue, EBITDA, PBT and PAT for the quarter come straight from tagged facts.
Each filing only carries the current quarter (plus YTD), so QoQ / YoY are built
by the caller from three filings — see `compare()`.

Banks file a different schedule (no revenue / EBITDA). For them we report
NII (interest earned − expended), PPOP (pre-provision operating profit), PBT, PAT.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from datetime import date

CRORE = 10_000_000

_CONTEXT = re.compile(
    r'<xbrli:context id="([^"]+)">.*?<xbrli:period>(.*?)</xbrli:period>', re.S
)
_START = re.compile(r"<xbrli:startDate>([\d-]+)</xbrli:startDate>")
_END = re.compile(r"<xbrli:endDate>([\d-]+)</xbrli:endDate>")
_FACT = re.compile(r'<[\w-]+:(\w+)\b[^>]*?contextRef="([^"]+)"[^>]*>([^<]*)<')


@dataclass(frozen=True)
class Headline:
    symbol: str | None
    period_start: date
    period_end: date
    consolidated: bool
    is_bank: bool
    # ₹ crore. For banks `revenue` is NII and `ebitda` is PPOP.
    revenue: float | None
    ebitda: float | None
    pbt: float | None
    pat: float | None
    # Non-operating pieces inside PBT, ₹ crore — feed the card's flags.
    other_income: float | None = None
    exceptional: float | None = None

    @property
    def labels(self) -> tuple[str, str, str, str]:
        if self.is_bank:
            return ("NII", "PPOP", "PBT", "PAT")
        return ("Revenue", "EBITDA", "PBT", "PAT")

    def as_dict(self) -> dict:
        d = asdict(self)
        d["period_start"] = self.period_start.isoformat()
        d["period_end"] = self.period_end.isoformat()
        d["labels"] = list(self.labels)
        return d


def _num(raw: str) -> float | None:
    raw = raw.strip().replace(",", "")
    try:
        return float(raw)
    except ValueError:
        return None


def _quarter_context(xml: str) -> tuple[str, date, date]:
    """The ~3-month duration context ending on the latest period end."""
    best: tuple[str, date, date] | None = None
    for cid, period in _CONTEXT.findall(xml):
        s, e = _START.search(period), _END.search(period)
        if not (s and e):
            continue
        start, end = date.fromisoformat(s.group(1)), date.fromisoformat(e.group(1))
        if not 80 <= (end - start).days <= 100:
            continue
        if best is None or end > best[2]:
            best = (cid, start, end)
    if best is None:
        raise ValueError("no quarterly duration context in XBRL")
    return best


def parse_headline(xml: str) -> Headline:
    cid, start, end = _quarter_context(xml)
    facts: dict[str, float] = {}
    text: dict[str, str] = {}
    for name, ctx, raw in _FACT.findall(xml):
        value = _num(raw)
        if ctx == cid and value is not None:
            facts.setdefault(name, value)
        elif value is None and raw.strip():
            text.setdefault(name, raw.strip())

    def first(*names: str) -> float | None:
        for n in names:
            if n in facts:
                return facts[n]
        return None

    def cr(v: float | None) -> float | None:
        return None if v is None else round(v / CRORE, 2)

    is_bank = "InterestEarned" in facts
    pbt = first("ProfitBeforeTax", "ProfitLossFromOrdinaryActivitiesBeforeTax")
    pat = first(
        "ProfitOrLossAttributableToOwnersOfParent",
        "ProfitLossAfterTaxesMinorityInterestAndShareOfProfitLossOfAssociates",
        "ProfitLossForPeriod",
        "ProfitLossForThePeriod",
    )
    if is_bank:
        earned, expended = first("InterestEarned"), first("InterestExpended")
        revenue = None if earned is None or expended is None else earned - expended
        ebitda = first("OperatingProfitBeforeProvisionAndContingencies")
    else:
        revenue = first("RevenueFromOperations")
        fin = first("FinanceCosts")
        dep = first("DepreciationDepletionAndAmortisationExpense")
        other = first("OtherIncome") or 0.0
        # Operating EBITDA: start before exceptional items, drop associate/JV share
        # and other income, add back finance costs and D&A.
        base = first("ProfitBeforeExceptionalItemsAndTax")
        if base is None and pbt is not None:
            base = pbt - (first("ExceptionalItemsBeforeTax") or 0.0)
        jv = first("ShareOfProfitLossOfAssociatesAndJointVenturesAccountedForUsingEquityMethod") or 0.0
        if base is not None and "ProfitBeforeExceptionalItemsAndTax" not in facts:
            jv = 0.0  # legacy schedules put the JV share after PBT
        ebitda = None if None in (base, fin, dep) else base - jv + fin + dep - other

    nature = text.get("NatureOfReportStandaloneConsolidated", "")
    return Headline(
        symbol=text.get("Symbol"),
        period_start=start,
        period_end=end,
        consolidated=nature.lower().startswith("consolidated") if nature else True,
        is_bank=is_bank,
        revenue=cr(revenue),
        ebitda=cr(ebitda),
        pbt=cr(pbt),
        pat=cr(pat),
        other_income=cr(first("OtherIncome")),
        exceptional=cr(first("ExceptionalItemsBeforeTax")),
    )


def _pct(now: float | None, then: float | None) -> float | None:
    if now is None or then is None or then == 0:
        return None
    return round((now - then) / abs(then) * 100, 1)


def compare(
    current: Headline, prev_q: Headline | None, year_ago: Headline | None
) -> dict:
    """Results card payload: the four headline lines with QoQ and YoY change."""
    rows = []
    for label, field in zip(current.labels, ("revenue", "ebitda", "pbt", "pat"), strict=True):
        now = getattr(current, field)
        q = getattr(prev_q, field) if prev_q else None
        y = getattr(year_ago, field) if year_ago else None
        rows.append(
            {
                "label": label,
                "value": now,
                "prev_q": q,
                "year_ago": y,
                "qoq_pct": _pct(now, q),
                "yoy_pct": _pct(now, y),
            }
        )
    margin = None
    if not current.is_bank and current.revenue and current.ebitda is not None:
        margin = round(current.ebitda / current.revenue * 100, 1)
    flags = []
    if current.pbt and current.pbt > 0:
        if not current.is_bank and current.other_income and current.other_income / current.pbt >= 0.25:
            flags.append(
                f"Other income ₹{current.other_income:,.0f} Cr is "
                f"{current.other_income / current.pbt:.0%} of PBT"
            )
        if current.exceptional and abs(current.exceptional) / current.pbt >= 0.05:
            sign = "gain" if current.exceptional > 0 else "charge"
            flags.append(f"Exceptional {sign} of ₹{abs(current.exceptional):,.0f} Cr in PBT")
    return {
        "symbol": current.symbol,
        "flags": flags,
        "period_end": current.period_end.isoformat(),
        "consolidated": current.consolidated,
        "is_bank": current.is_bank,
        "ebitda_margin_pct": margin,
        "rows": rows,
    }

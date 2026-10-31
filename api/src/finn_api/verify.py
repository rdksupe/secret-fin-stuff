"""Do the numbers FINN writes actually appear in the sources it cites?

Deterministic and model-free. Every figure in a generated line (one-liner, dossier row,
bull/bear point) is extracted, normalised, and looked for in the source material — the
filing text, the cited transcript / annual-report pages, the XBRL series. A figure counts as
found if the source contains the same quantity at the precision it was written
(₹13,884 Cr matches 13,883.6; 24% matches 24.0 and 23.96).

This catches the failure that matters — a model inventing or mis-copying a number — without
pretending to judge whether the prose around it is right.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Things that look numeric but are labels, not quantities.
_SKIP = re.compile(
    r"\b(?:Q[1-4]|H[12]|FY\s?\d{2,4}|20\d\d|19\d\d|p\.?\s?\d+|pages?\s\d+|\d{1,2}[-/ ](?:[A-Z][a-z]{2}|\d{1,2})[-/ ]\d{2,4})\b"
)
_NUM = re.compile(
    r"(?P<cur>[₹$€£])?\s?(?P<num>\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?"
    r"(?P<unit>%|bps|bp|cr\b|crore|lakh|lac|mn|million|bn|billion|k\b|x\b)?",
    re.I,
)


@dataclass
class Figure:
    raw: str
    value: float
    decimals: int
    unit: str  # "%", "bps", "inr_cr", "money", ""


@dataclass
class Check:
    checked: int = 0
    found: int = 0
    missing: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.checked == self.found

    def as_dict(self) -> dict:
        return {"checked": self.checked, "found": self.found, "missing": self.missing}


def figures(text: str) -> list[Figure]:
    clean = _SKIP.sub(" ", text or "")
    out: list[Figure] = []
    for m in _NUM.finditer(clean):
        num = m.group("num")
        unit = (m.group("unit") or "").lower()
        cur = m.group("cur") or ""
        v = float(num.replace(",", ""))
        dec = len(num.split(".")[1]) if "." in num else 0
        if not unit and not cur and v < 10 and dec == 0:
            continue  # small bare integers ("3 deals", "2 calls") are rarely the claim
        if unit in ("lakh", "lac"):
            v, unit = v / 100, "inr_cr"  # compare in crore
        elif unit in ("cr", "crore"):
            unit = "inr_cr"
        elif unit in ("bn", "billion"):
            unit = "money_bn"
        elif unit in ("mn", "million"):
            unit = "money_mn"
        elif unit == "bp":
            unit = "bps"
        out.append(Figure(raw=m.group(0).strip(), value=v, decimals=dec, unit=unit))
    return out


def _values(source: str) -> list[float]:
    vals = []
    for f in figures(source):
        vals.append(f.value)
        if f.unit == "inr_cr":
            vals.append(f.value * 100)  # the same amount written in lakh
    return vals


def _matches(f: Figure, pool: list[float]) -> bool:
    tol = 0.5 * 10 ** (-f.decimals) + 1e-9  # what rounding to the written precision allows
    for v in pool:
        if abs(v - f.value) <= tol or abs(abs(v) - abs(f.value)) <= tol:
            return True
        # Same quantity in a different scale (₹ crore vs ₹ lakh/mn, $bn vs $mn).
        for k in (10, 100, 1000):
            if abs(v - f.value * k) <= tol * k or abs(v * k - f.value) <= tol:
                return True
    return False


def check(text: str, sources: list[str], extra_values: list[float] | None = None) -> Check:
    pool = _values("\n".join(s for s in sources if s)) + [v for v in (extra_values or []) if v is not None]
    c = Check()
    seen: set[str] = set()
    for f in figures(text):
        key = f"{f.value}{f.unit}"
        if key in seen:
            continue
        seen.add(key)
        c.checked += 1
        if _matches(f, pool):
            c.found += 1
        else:
            c.missing.append(f.raw)
    return c


def series_values(series: list[dict]) -> list[float]:
    """Every number in the XBRL trajectory, including the derived YoY and margins."""
    out: list[float] = []
    for r in series:
        for k in ("revenue", "ebitda", "ebit", "pbt", "pat", "revenue_yoy", "pat_yoy", "margin", "op_margin"):
            v = r.get(k)
            if isinstance(v, int | float):
                out.append(float(v))
    return out

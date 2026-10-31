"""screener.in company page: the company's own business description and document links.

The "About" text is lifted from the company's filings, so it's first-party context —
Jev and the LLM need it to judge whether an event hits the core business.
"""

from __future__ import annotations

import html
import re

import httpx

from finn_api.config import settings

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36"}


def _cache(symbol: str):
    d = settings.finn_cache_dir / "screener"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{symbol.upper()}.html"


def page(symbol: str, *, refresh: bool = False) -> str:
    cp = _cache(symbol)
    if cp.exists() and not refresh:
        return cp.read_text(encoding="utf-8")
    for path in (f"/company/{symbol.upper()}/consolidated/", f"/company/{symbol.upper()}/"):
        try:
            r = httpx.get(f"https://www.screener.in{path}", headers=UA, follow_redirects=True, timeout=20)
        except httpx.HTTPError:
            continue
        if r.status_code == 200 and "company-info" in r.text:
            cp.write_text(r.text, encoding="utf-8")
            return r.text
    return cp.read_text(encoding="utf-8") if cp.exists() else ""


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment))).replace("[1]", "").strip()


def about(symbol: str) -> str:
    m = re.search(r'<div class="sub show-more-box about"[^>]*>(.*?)</div>', page(symbol), re.S)
    return _text(m.group(1))[:800] if m else ""


def key_points(symbol: str) -> str:
    m = re.search(r'<div class="sub commentary always-show-more-box"[^>]*>(.*?)</div>', page(symbol), re.S)
    return _text(m.group(1))[:1500] if m else ""


_MONTHS = {m: i for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


def documents(symbol: str) -> dict:
    """Primary documents screener links to (hosted on BSE / the company's site).

    {"annual_reports": [{"year": 2026, "url": …}], "concalls": [{"month": "2026-10", "transcript": …}]}
    newest first.
    """
    h = page(symbol)
    i = h.find('id="documents"')
    seg = h[i:] if i >= 0 else ""
    out: dict = {"annual_reports": [], "concalls": []}

    a = seg.find("Annual reports")
    if a >= 0:
        block = seg[a: seg.find("</ul>", a)]
        for href, label in re.findall(r'<a\s+href="([^"]+)"[^>]*>\s*([^<]*Annual Report[^<]*)</a>', block):
            y = re.search(r"(20\d\d)", label)
            out["annual_reports"].append({"year": int(y.group(1)) if y else None, "url": html.unescape(href),
                                          "label": label.strip()})

    c = seg.find("Concalls")
    if c >= 0:
        block = seg[c: seg.find("</ul>", c)]
        for li in re.findall(r"<li[^>]*>(.*?)</li>", block, re.S):
            when = re.search(r">\s*([A-Z][a-z]{2}) (20\d\d)\s*</div>", li)
            tr = re.search(r'<a\s+class="button-chip"\s+href="([^"]+)"[^>]*title="Raw Transcript"', li)
            if when and tr:
                mon = _MONTHS.get(when.group(1), 1)
                out["concalls"].append({"month": f"{when.group(2)}-{mon:02d}", "transcript": html.unescape(tr.group(1))})
    return out

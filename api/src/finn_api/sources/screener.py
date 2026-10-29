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

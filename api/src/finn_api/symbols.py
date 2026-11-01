"""NSE's equity list, for symbol search and for refusing symbols that don't exist.

Source: NSE's own `EQUITY_L.csv` (every listed equity, with company name and ISIN), fetched through
the archive client once a day and kept in memory.
"""

from __future__ import annotations

import csv
import io
import logging
import threading
from datetime import date

from fastapi import APIRouter, Depends

from finn_api.auth import require_auth
from finn_api.sources.nse import NSE

log = logging.getLogger("finn.symbols")
router = APIRouter(prefix="/api", dependencies=[Depends(require_auth)])

URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"
_lock = threading.Lock()
_cache: dict = {"day": None, "rows": []}


def equities() -> list[dict]:
    """[{symbol, name, series, isin}] for every NSE-listed equity; [] if NSE can't be reached."""
    today = date.today()
    with _lock:
        if _cache["day"] == today and _cache["rows"]:
            return _cache["rows"]
        try:
            raw = NSE().get_archive(f"{URL}?d={today:%Y%m%d}")  # one cached copy per day
            rows = [
                {"symbol": r["SYMBOL"].strip().upper(), "name": (r.get("NAME OF COMPANY") or "").strip(),
                 "series": (r.get(" SERIES") or r.get("SERIES") or "").strip(), "isin": (r.get(" ISIN NUMBER") or "").strip()}
                for r in csv.DictReader(io.StringIO(raw.decode("utf-8", "ignore")))
                if r.get("SYMBOL")
            ]
            if rows:
                _cache.update(day=today, rows=rows)
        except Exception as e:  # keep yesterday's list if today's fetch fails
            log.warning("equity list fetch failed: %s", e)
        return _cache["rows"]


def known(symbol: str) -> bool | None:
    """True / False when the list is available; None when it isn't (callers then don't block)."""
    rows = equities()
    if not rows:
        return None
    return any(r["symbol"] == symbol.upper() for r in rows)


def search(q: str, limit: int = 8) -> list[dict]:
    """Symbol prefix first, then a company-name word prefix, then anywhere in the name."""
    q = q.strip().upper()
    if not q:
        return []
    scored = []
    for r in equities():
        sym, name = r["symbol"], r["name"].upper()
        if sym == q:
            s = 0
        elif sym.startswith(q):
            s = 1
        elif any(w.startswith(q) for w in name.replace("&", " ").split()):
            s = 2
        elif q in name or q in sym:
            s = 3
        else:
            continue
        scored.append((s, len(sym), sym, r))
    scored.sort(key=lambda t: t[:3])
    return [{"symbol": r["symbol"], "name": r["name"]} for *_, r in scored[: max(1, min(limit, 20))]]


@router.get("/symbols")
def symbol_search(q: str = "", limit: int = 8):
    return search(q, limit)

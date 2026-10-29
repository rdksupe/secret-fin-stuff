"""NSE client: announcements, results filings (XBRL), EOD bhavcopy.

Every successful response is written to `finn_cache_dir`. When NSE blocks or
times out, the last cached copy is served instead (marked `stale=True` by the
`fetch_*` helpers), so crons and the demo degrade instead of failing.

NSE's JSON API wants a browser UA, a Referer, and the cookies a page visit
sets. The homepage itself often 403s from scripts but the API still answers;
we warm cookies from a quote page and retry once on 401/403.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
import time
import zipfile
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

import httpx

from finn_api.config import settings

log = logging.getLogger("finn.nse")

BASE = "https://www.nseindia.com"
ARCHIVES = "https://nsearchives.nseindia.com"
UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/141.0 Safari/537.36"
)
_HEADERS = {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": f"{BASE}/companies-listing/corporate-filings-announcements",
}


class NSEError(RuntimeError):
    pass


@dataclass(frozen=True)
class Bar:
    symbol: str
    series: str
    day: date
    open: float
    high: float
    low: float
    close: float
    prev_close: float
    volume: int
    value: float  # ₹ traded

    @property
    def change_pct(self) -> float:
        return round((self.close - self.prev_close) / self.prev_close * 100, 2) if self.prev_close else 0.0


def _ddmmyyyy(d: date) -> str:
    return d.strftime("%d-%m-%Y")


class NSE:
    def __init__(self, cache_dir: Path | None = None, client: httpx.Client | None = None):
        self.cache_dir = cache_dir or settings.finn_cache_dir / "nse"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.client = client or httpx.Client(headers=_HEADERS, timeout=20, follow_redirects=True)
        self._warm = False

    # ── transport ──────────────────────────────────────────────────────────

    def _cache_path(self, url: str, params: dict | None, suffix: str) -> Path:
        key = url + "?" + json.dumps(params or {}, sort_keys=True)
        return self.cache_dir / (hashlib.sha1(key.encode()).hexdigest()[:20] + suffix)

    def _warmup(self) -> None:
        try:
            self.client.get(f"{BASE}/get-quotes/equity?symbol=TCS")
        except httpx.HTTPError as e:
            log.debug("nse warmup failed: %s", e)
        self._warm = True

    def _get(self, url: str, params: dict | None = None) -> httpx.Response:
        last: Exception | None = None
        for attempt in range(3):
            try:
                r = self.client.get(url, params=params)
                if r.status_code in (401, 403) and attempt == 0:
                    self._warmup()
                    continue
                r.raise_for_status()
                return r
            except httpx.HTTPError as e:
                last = e
                time.sleep(0.6 * (attempt + 1))
        raise NSEError(f"GET {url} failed: {last}")

    def get_json(self, path: str, params: dict | None = None, *, max_age: float | None = None):
        """JSON from the NSE API with read-through/fallback disk cache.

        `max_age` (seconds): serve the cache without hitting NSE if it is fresher.
        """
        url = f"{BASE}/api/{path}"
        cp = self._cache_path(url, params, ".json")
        if max_age is not None and cp.exists() and time.time() - cp.stat().st_mtime < max_age:
            return json.loads(cp.read_text())
        try:
            data = self._get(url, params).json()
        except (NSEError, ValueError) as e:
            if cp.exists():
                log.warning("NSE %s failed (%s); serving cache", path, e)
                return json.loads(cp.read_text())
            raise
        cp.write_text(json.dumps(data))
        return data

    def get_archive(self, url: str) -> bytes:
        """Immutable archive files (XBRL, PDFs, bhavcopy) — cache forever."""
        suffix = Path(url.split("?")[0]).suffix or ".bin"
        cp = self._cache_path(url, None, suffix)
        if cp.exists():
            return cp.read_bytes()
        body = self._get(url).content
        cp.write_bytes(body)
        return body

    # ── announcements ──────────────────────────────────────────────────────

    def announcements(
        self,
        *,
        symbol: str | None = None,
        start: date | None = None,
        end: date | None = None,
        max_age: float | None = None,
    ) -> list[dict]:
        """Corporate announcements, newest first. No symbol = whole market."""
        params: dict[str, str] = {"index": "equities"}
        if symbol:
            params["symbol"] = symbol.upper()
        if start or end:
            end = end or date.today()
            start = start or end - timedelta(days=1)
            params["from_date"], params["to_date"] = _ddmmyyyy(start), _ddmmyyyy(end)
        rows = self.get_json("corporate-announcements", params, max_age=max_age)
        return rows if isinstance(rows, list) else rows.get("data", [])

    # ── results ────────────────────────────────────────────────────────────

    def results_filings(self, symbol: str, *, consolidated: bool = True) -> list[dict]:
        """Quarterly results filings with an XBRL link, newest period first.

        Merges the Integrated Filing list (2025→) with the legacy results list
        (→ Dec 2024). Each item: {period_end, consolidated, xbrl, filed}.
        """
        want = "Consolidated" if consolidated else "Standalone"
        out: dict[date, dict] = {}

        integrated = self.get_json(
            "integrated-filing-results",
            {"index": "equities", "symbol": symbol.upper(), "period_ended": "all",
             "type": "Integrated Filing- Financials"},
            max_age=6 * 3600,
        )
        for r in integrated.get("data", []) if isinstance(integrated, dict) else []:
            if r.get("consolidated") != want or not r.get("xbrl"):
                continue
            pe = datetime.strptime(r["qe_Date"].title(), "%d-%b-%Y").date()
            out.setdefault(pe, {"period_end": pe, "consolidated": consolidated,
                                "xbrl": r["xbrl"], "filed": r.get("broadcast_Date")})

        legacy = self.get_json(
            "corporates-financial-results",
            {"index": "equities", "symbol": symbol.upper(), "period": "Quarterly"},
            max_age=24 * 3600,
        )
        for r in legacy if isinstance(legacy, list) else []:
            xbrl = r.get("xbrl") or ""
            if r.get("consolidated") != want or xbrl.endswith("/-") or not xbrl.endswith(".xml"):
                continue
            pe = datetime.strptime(r["toDate"], "%d-%b-%Y").date()
            out.setdefault(pe, {"period_end": pe, "consolidated": consolidated,
                                "xbrl": xbrl, "filed": r.get("filingDate")})

        return sorted(out.values(), key=lambda x: x["period_end"], reverse=True)

    def xbrl(self, url: str) -> str:
        return self.get_archive(url).decode("utf-8", errors="ignore")

    # ── EOD ────────────────────────────────────────────────────────────────

    def bhavcopy(self, day: date) -> dict[str, Bar]:
        """All NSE cash-market equity bars for one trading day (EQ/BE/BZ series)."""
        url = f"{ARCHIVES}/content/cm/BhavCopy_NSE_CM_0_0_0_{day:%Y%m%d}_F_0000.csv.zip"
        raw = self.get_archive(url)
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            text = zf.read(zf.namelist()[0]).decode("utf-8", errors="ignore")
        return parse_bhavcopy(text)

    def recent_bhavcopies(self, n: int, *, until: date | None = None) -> list[dict[str, Bar]]:
        """Last `n` trading days, oldest first. Holidays / weekends are skipped."""
        day = until or date.today()
        days: list[dict[str, Bar]] = []
        tries = 0
        while len(days) < n and tries < n * 2 + 10:
            tries += 1
            if day.weekday() < 5:
                try:
                    days.append(self.bhavcopy(day))
                except (NSEError, zipfile.BadZipFile):
                    pass  # holiday, or not published yet
            day -= timedelta(days=1)
        return list(reversed(days))


def parse_bhavcopy(text: str) -> dict[str, Bar]:
    bars: dict[str, Bar] = {}
    for r in csv.DictReader(io.StringIO(text)):
        if r.get("SctySrs") not in ("EQ", "BE", "BZ"):
            continue
        try:
            bars[r["TckrSymb"]] = Bar(
                symbol=r["TckrSymb"],
                series=r["SctySrs"],
                day=date.fromisoformat(r["TradDt"]),
                open=float(r["OpnPric"]),
                high=float(r["HghPric"]),
                low=float(r["LwPric"]),
                close=float(r["ClsPric"]),
                prev_close=float(r["PrvsClsgPric"]),
                volume=int(float(r["TtlTradgVol"])),
                value=float(r["TtlTrfVal"]),
            )
        except (KeyError, ValueError):
            continue
    return bars

"""Pull 6 months of market-wide NSE announcements, bhavcopies and index closes (cached)."""

import csv
import io
import json
import sys
from datetime import date, timedelta
from pathlib import Path

from finn_api.config import settings
from finn_api.sources.nse import NSE, NSEError

OUT = settings.finn_cache_dir.parent / "research"
OUT.mkdir(parents=True, exist_ok=True)
START, END = date(2026, 5, 1), date(2026, 10, 29)
nse = NSE()

# 1. announcements, weekly windows
ann = []
d = START
while d <= END:
    e = min(d + timedelta(days=6), END)
    try:
        rows = nse.announcements(start=d, end=e)
        ann += rows
        print(f"ann {d}..{e}: {len(rows)}", flush=True)
    except NSEError as ex:
        print(f"ann {d}..{e} FAILED {ex}", flush=True)
    d = e + timedelta(days=1)
(OUT / "announcements.json").write_text(json.dumps(ann))
print("announcements total", len(ann), flush=True)

# 2. bhavcopies (60-day lookback for volatility)
days = nse.recent_bhavcopies(190, until=END)
print("bhavcopy days", len(days), next(iter(days[0].values())).day, "→", next(iter(days[-1].values())).day, flush=True)

# 3. index closes
idx = {}
for bars in days:
    day = next(iter(bars.values())).day
    url = f"https://nsearchives.nseindia.com/content/indices/ind_close_all_{day:%d%m%Y}.csv"
    try:
        text = nse.get_archive(url).decode("utf-8", errors="ignore")
    except NSEError:
        continue
    for r in csv.DictReader(io.StringIO(text)):
        if r["Index Name"] in ("Nifty 50", "Nifty Smallcap 250", "Nifty Midcap 150"):
            idx.setdefault(day.isoformat(), {})[r["Index Name"]] = float(r["Change(%)"] or 0)
(OUT / "index_changes.json").write_text(json.dumps(idx))
print("index days", len(idx), flush=True)

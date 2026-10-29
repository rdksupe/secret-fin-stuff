"""Label filings by market reaction: did the stock move abnormally on the reaction day?

Output: data/research/labeled.json — one row per candidate filing with
  reaction_day, abnormal_ret, sigma, vol_x, material (bool), direction (-1/0/1),
  plus cheap context features (intraday, turnover, same-day counts).
"""

import json
import math
from bisect import bisect_left
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from statistics import median, pstdev

from finn_api.config import settings
from finn_api.pipeline import CASCADE
from finn_api.sources import taxonomy
from finn_api.sources.nse import NSE

OUT = settings.finn_cache_dir.parent / "research"
SIGMA_K, VOL_K = 2.5, 3.0
MIN_TURNOVER = 1e7  # ₹1 Cr median daily
# Filings that follow a move instead of causing one — would leak the label.
REACTIVE = {"Price movement", "Spurt in Volume", "News Verification"}

ann = json.loads((OUT / "announcements.json").read_text())
idx = json.loads((OUT / "index_changes.json").read_text())
days = NSE().recent_bhavcopies(190, until=date(2026, 10, 29))
tdays = [next(iter(d.values())).day for d in days]

# per-symbol daily series
series: dict[str, dict[date, tuple[float, int, float]]] = defaultdict(dict)  # day → (ret%, volume, turnover)
for bars, day in zip(days, tdays, strict=True):
    for sym, b in bars.items():
        if b.prev_close:
            series[sym][day] = (b.change_pct, b.volume, b.value)


def reaction_day(ts: datetime) -> date | None:
    d = ts.date()
    i = bisect_left(tdays, d)
    if i < len(tdays) and tdays[i] == d and ts.time() < time(15, 30):
        return d
    j = i + 1 if i < len(tdays) and tdays[i] == d else i
    return tdays[j] if j < len(tdays) else None


# Results days: price reacts to the numbers, not to the press release / dividend /
# auditor note filed at the same board meeting. Drop those company-days (±1 day).
results_days: set[tuple[str, date]] = set()
for a in ann:
    c = taxonomy.classify(a.get("desc", ""), a.get("attchmntText", ""))
    if c.key == "results" or taxonomy._RESULTS_TEXT.search(a.get("attchmntText") or ""):
        if a.get("sort_date"):
            d0 = datetime.fromisoformat(a["sort_date"]).date()
            results_days |= {(a.get("symbol"), d0 + timedelta(days=k)) for k in (-1, 0, 1, 2, 3)}

rows = []
seen = set()
dropped_results = 0
for a in ann:
    if a.get("desc") in REACTIVE or not a.get("sort_date"):
        continue
    key = a.get("seq_id")
    if key in seen:
        continue
    seen.add(key)
    cat = taxonomy.classify(a.get("desc", ""), a.get("attchmntText", ""))
    if cat.key not in CASCADE:
        continue
    sym = a.get("symbol")
    ts = datetime.fromisoformat(a["sort_date"])
    rd = reaction_day(ts)
    s = series.get(sym)
    if not rd or not s or rd not in s:
        continue
    if (sym, rd) in results_days:
        dropped_results += 1
        continue
    past = [d for d in s if d < rd]
    past.sort()
    if len(past) < 40:
        continue
    abn_hist = [s[d][0] - idx.get(d.isoformat(), {}).get("Nifty 50", 0.0) for d in past[-60:]]
    sigma = pstdev(abn_hist) or 1.0
    turn = median(s[d][2] for d in past[-20:])
    if turn < MIN_TURNOVER:
        continue
    avg_vol = sum(s[d][1] for d in past[-20:]) / 20
    ret, vol, _ = s[rd]
    abn = ret - idx.get(rd.isoformat(), {}).get("Nifty 50", 0.0)
    vol_x = vol / avg_vol if avg_vol else 0.0
    material = abs(abn) >= SIGMA_K * sigma or vol_x >= VOL_K
    rows.append({
        "seq_id": key, "symbol": sym, "company": a.get("sm_name"), "industry": a.get("smIndustry"),
        "desc": a.get("desc"), "text": a.get("attchmntText"), "pdf": a.get("attchmntFile"),
        "sort_date": a["sort_date"], "reaction_day": rd.isoformat(),
        "rule_category": cat.key, "rule_tier": cat.tier,
        "intraday": ts.time() < time(15, 30) and rd == ts.date(),
        "log_turnover": round(math.log10(turn), 3),
        "abnormal_ret": round(abn, 2), "sigma": round(sigma, 2), "vol_x": round(vol_x, 2),
        "material": material, "direction": (1 if abn > 0 else -1) if material else 0,
    })

# same-day context (confounders)
by_day = defaultdict(list)
for r in rows:
    by_day[(r["symbol"], r["reaction_day"])].append(r)
for group in by_day.values():
    for r in group:
        r["same_day_filings"] = len(group) - 1

(OUT / "labeled.json").write_text(json.dumps(rows))
pos = sum(r["material"] for r in rows)
print(f"dropped {dropped_results} filings on results days")
print(f"{len(rows)} labeled filings ({len({r['symbol'] for r in rows})} companies); "
      f"material {pos} ({pos / max(len(rows), 1):.1%})")
by_cat = defaultdict(lambda: [0, 0])
for r in rows:
    by_cat[r["rule_category"]][0] += 1
    by_cat[r["rule_category"]][1] += r["material"]
for c, (n, p) in sorted(by_cat.items(), key=lambda kv: -kv[1][0]):
    print(f"  {c:12} n={n:5}  material={p / n:.1%}")

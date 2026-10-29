"""Jev features for a balanced sample of labeled filings — the exact production call.

Resumable: appends to data/research/features.jsonl, skips seq_ids already done.
  uv run python ../research/materiality/features.py [n_per_class]
"""

import json
import random
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

from finn_api.config import settings
from finn_api.materiality import build_state, jev_nouls
from finn_api.sources import pdf, screener
from finn_api.sources.nse import NSE

OUT = settings.finn_cache_dir.parent / "research"
N = int(sys.argv[1]) if len(sys.argv) > 1 else 1500
rows = json.loads((OUT / "labeled.json").read_text())
done_path = OUT / "features.jsonl"
done = set()
if done_path.exists():
    done = {json.loads(line)["seq_id"] for line in done_path.read_text().splitlines() if line.strip()}

random.seed(11)
pos = [r for r in rows if r["material"]]
neg = [r for r in rows if not r["material"]]
sample = random.sample(pos, min(N, len(pos))) + random.sample(neg, min(N, len(neg)))
sample += [r for r in rows if r["symbol"] == "EMUDHRA" and r not in sample]  # the replay case
todo = [r for r in sample if r["seq_id"] not in done]
print(f"sample {len(sample)} ({min(N, len(pos))} material), {len(todo)} to do", flush=True)

nse = NSE()
lock = threading.Lock()
_about: dict[str, str] = {}
_screener_ok = [True]


def describe(r: dict) -> str:
    sym = r["symbol"]
    if sym not in _about:
        text = ""
        if _screener_ok[0]:
            try:
                text = screener.about(sym)
            except Exception:
                _screener_ok[0] = False  # rate limited — fall back for the rest of the run
        _about[sym] = text or (f"Industry: {r['industry']}" if r.get("industry") else "")
    return _about[sym]


def work(r: dict) -> dict | None:
    body, pages = r.get("text") or "", 0
    if r.get("pdf"):
        try:
            texts, pages = pdf.pages_text(nse.get_archive(r["pdf"]), limit=3)
            body = pdf.body(texts) or body
        except Exception:
            pass
    ann = {"sm_name": r["company"], "symbol": r["symbol"], "desc": r["desc"], "attchmntText": r["text"]}
    n = jev_nouls(build_state(ann, describe(r), body))
    if n is None:
        return None
    return {"seq_id": r["seq_id"], "nouls": n, "body_len": len(body), "pdf_pages": pages,
            "has_about": not _about.get(r["symbol"], "").startswith("Industry:")}


ok = 0
with ThreadPoolExecutor(max_workers=8) as ex, done_path.open("a") as f:
    futs = {ex.submit(work, r): r for r in todo}
    for i, fut in enumerate(as_completed(futs), 1):
        res = fut.result()
        if res:
            with lock:
                f.write(json.dumps(res) + "\n")
                f.flush()
            ok += 1
        if i % 100 == 0:
            print(f"{i}/{len(todo)} done ({ok} ok)", flush=True)
print(f"finished: {ok} new feature rows", flush=True)

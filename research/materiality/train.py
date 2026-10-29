"""Train a logistic regression on Jev Nouls + context to predict market reaction.

Time split: train on reaction days < 2026-09-01, test on Sep–Oct (EMUDHRA's Oct
incident is in test). Baselines: hand-set composite (materiality.combine) and rules tier.
Writes api/src/finn_api/materiality_model.json when it beats the composite.
"""

import json
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score

from finn_api.config import settings
from finn_api.materiality import NOULS, combine

OUT = settings.finn_cache_dir.parent / "research"
MODEL_PATH = Path(__file__).resolve().parents[2] / "api" / "src" / "finn_api" / "materiality_model.json"
SPLIT = "2026-09-01"

labeled = {r["seq_id"]: r for r in json.loads((OUT / "labeled.json").read_text())}
feats = [json.loads(line) for line in (OUT / "features.jsonl").read_text().splitlines() if line.strip()]
rows = [(labeled[f["seq_id"]], f) for f in feats if f["seq_id"] in labeled]
GENERIC = {"other", "investor"}


def vec(r: dict, f: dict) -> list[float]:
    n = f["nouls"]
    return [
        n["incident"], n["third_party_action"], n["core_business"], n["stops_activity"],
        n["claims_immaterial"], n["routine"],
        n["incident"] * n["core_business"], n["third_party_action"] * n["core_business"],
        n["stops_activity"] * n["core_business"],
        float(r["intraday"]), r["log_turnover"] - 8, min(r["same_day_filings"], 5) / 5,
        float(r["rule_category"] in GENERIC), r["rule_tier"] / 3,
        min(f["body_len"], 2500) / 2500, min(f["pdf_pages"], 20) / 20,
    ]


NAMES = [*NOULS, "incident×core", "third_party×core", "stops×core", "intraday", "log_turnover",
         "same_day_filings", "generic_bucket", "rule_tier", "body_len", "pdf_pages"]

train = [(r, f) for r, f in rows if r["reaction_day"] < SPLIT]
test = [(r, f) for r, f in rows if r["reaction_day"] >= SPLIT]
Xtr = np.array([vec(r, f) for r, f in train]); ytr = np.array([r["material"] for r, _ in train])
Xte = np.array([vec(r, f) for r, f in test]); yte = np.array([r["material"] for r, _ in test])
print(f"train {len(train)} ({ytr.mean():.0%} material) | test {len(test)} ({yte.mean():.0%} material)")

model = LogisticRegression(C=1.0, max_iter=2000, class_weight="balanced").fit(Xtr, ytr)
p = model.predict_proba(Xte)[:, 1]
hand = np.array([combine(f["nouls"])[0] for _, f in test])
tier = np.array([r["rule_tier"] for r, _ in test], dtype=float)


def report(name, score):
    print(f"  {name:22} ROC-AUC {roc_auc_score(yte, score):.3f}   PR-AUC {average_precision_score(yte, score):.3f}")


print("\nTest (Sep–Oct, unseen):")
report("rules tier", tier)
report("hand composite (Jev)", hand)
report("logistic (Jev+ctx)", p)
only_jev = LogisticRegression(max_iter=2000, class_weight="balanced").fit(Xtr[:, :9], ytr)
report("logistic (Jev only)", only_jev.predict_proba(Xte[:, :9])[:, 1])

print("\nWeights (standardised features would be comparable; these are raw):")
for nm, w in sorted(zip(NAMES, model.coef_[0], strict=True), key=lambda t: -abs(t[1])):
    print(f"  {nm:20} {w:+.2f}")


def band(lo_recall=0.9):
    """Thresholds: below lo → clear (keeps ~90% of material above it); above hi → adverse."""
    order = np.sort(p[yte])
    lo = float(order[int((1 - lo_recall) * len(order))]) if len(order) else 0.3
    hi = float(np.quantile(p[~yte], 0.97)) if (~yte).any() else 0.7
    return lo, max(hi, lo + 0.05)


lo, hi = band()
routed = ((p > lo) & (p < hi)).mean()
print(f"\nBand: clear < {lo:.2f} ≤ uncertain→LLM < {hi:.2f} ≤ adverse"
      f" | to LLM {routed:.0%} of test, recall above clear {(p[yte] > lo).mean():.0%},"
      f" adverse precision {yte[p >= hi].mean() if (p >= hi).any() else float('nan'):.0%}")

print("\nEMUDHRA in test:")
for (r, f), pi, hi_ in zip(test, p, hand, strict=True):
    if r["symbol"] == "EMUDHRA":
        print(f"  {r['sort_date'][:16]} {r['desc'][:28]:28} market={'MATERIAL' if r['material'] else '-':8} "
              f"abn={r['abnormal_ret']:+.1f}% p={pi:.2f} hand={hi_:.2f}")

auc_lr, auc_hand = roc_auc_score(yte, p), roc_auc_score(yte, hand)
if auc_lr > auc_hand:
    MODEL_PATH.write_text(json.dumps({
        "features": NAMES, "coef": model.coef_[0].tolist(), "intercept": float(model.intercept_[0]),
        "clear_below": lo, "adverse_at": hi, "test_auc": auc_lr, "hand_auc": auc_hand,
        "trained_on": len(train), "split": SPLIT,
    }, indent=1))
    print(f"\nwrote {MODEL_PATH} (AUC {auc_lr:.3f} vs hand {auc_hand:.3f})")
else:
    print(f"\nlogistic did not beat hand composite ({auc_lr:.3f} ≤ {auc_hand:.3f}); keeping hand weights")

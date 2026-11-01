"""Pull-side research: a grounded dossier per company, built only from primary sources.

Sources: the company's own concall transcripts and annual report (in its brain, via
screener → BSE/IR PDFs) and NSE results XBRL. No news, no broker notes, and the model is
told not to use outside knowledge. Every section cites the brain page it came from.

Model routing:
  guidance extraction, snapshot  → cheap model (bulk reading, cached per document)
  promised-vs-delivered, bull/bear → reasoning model (one call each, on compact inputs)
  trajectory                      → no model (computed from XBRL)
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import date
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from finn_api import llm
from finn_api.brain import Brain
from finn_api.config import settings
from finn_api.models import Document
from finn_api.results import _quarter_back
from finn_api.sources.nse import NSE
from finn_api.sources.xbrl import parse_headline

log = logging.getLogger("finn.research")
CHEAP = (settings.finn_model_cheap, settings.finn_model_reason)
REASON = (settings.finn_model_reason, settings.finn_model_cheap)
GROUNDING = (
    "Use ONLY the material provided below. Do not use outside knowledge of this company, news, "
    "or broker views. If the material does not say something, say it is not stated."
)


def _cache(brain: Brain, name: str) -> Path:
    d = brain.root / "raw" / "research"
    d.mkdir(parents=True, exist_ok=True)
    return d / name


def _pages(markdown: str) -> list[tuple[int, str]]:
    """Split a page-anchored brain document back into (page, text)."""
    parts = re.split(r'<a id="page-(\d+)"></a>', markdown)
    out = []
    for i in range(1, len(parts) - 1, 2):
        out.append((int(parts[i]), re.sub(r"^\s*## Page \d+\s*", "", parts[i + 1]).strip()))
    if not out:
        out = [(1, markdown)]
    return out


def _with_page_marks(markdown: str, limit: int) -> str:
    text = "\n".join(f"[p{p}] {t}" for p, t in _pages(markdown))
    return text[:limit]


# ── guidance ledger ───────────────────────────────────────────────────────

GUIDANCE_SYSTEM = (
    "You read part of an Indian listed company's earnings-call transcript. " + GROUNDING + " "
    'Return JSON: {"call": "<quarter the call discusses, e.g. Q2 FY27, or null>", '
    '"items": [{"metric": str (revenue growth, operating/EBIT margin, EBITDA margin, PAT, capex, order book, '
    'deal wins/TCV, volume, market share, segment growth, other), "statement": str (what was promised, plain words), '
    '"target": str (number/range as stated, or "directional"), "horizon": str (e.g. FY27, next quarter, medium term), '
    '"speaker": str, "quote": str (verbatim, <= 40 words), "page": int}], '
    '"reported": [{"metric": str, "value": str (the number management reported for the quarter just ended, '
    'e.g. "BFSI +3.2% QoQ CC", "operating margin 25.2%", "TCV $10bn"), "quote": str (verbatim, <= 30 words), '
    '"page": int}]}. '
    "items = forward-looking statements that could later be checked (skip pleasantries, history, analyst "
    "questions). reported = what management said was actually achieved this quarter, with numbers. "
    "At most 10 of each. Empty lists if this part has none."
)
_CHUNK = 30_000


def extract_guidance(db: Session, brain: Brain, doc: Document) -> dict:
    md = (brain.wiki / doc.wiki_path).read_text(encoding="utf-8")
    key = hashlib.sha1(md.encode()).hexdigest()[:12]
    cp = _cache(brain, f"guidance-v2-{key}.json")
    if cp.exists():
        return json.loads(cp.read_text())
    text = _with_page_marks(md, 120_000)
    chunks = [text[i:i + _CHUNK] for i in range(0, len(text), _CHUNK)][:4]
    out: dict = {"call": None, "items": [], "reported": []}
    ok = 0
    for ch in chunks:
        part = llm.chat_json(GUIDANCE_SYSTEM, ch, feature="research_guidance", db=db, models=CHEAP, max_tokens=12000)
        if not part:
            continue
        ok += 1
        out["call"] = out["call"] or part.get("call")
        out["items"] += part.get("items") or []
        out["reported"] += part.get("reported") or []

    def dedupe(rows: list[dict]) -> list[dict]:
        seen, keep = set(), []
        for r in rows:
            k = (r.get("quote") or r.get("statement") or r.get("value") or "")[:60].lower()
            if k and k not in seen:
                seen.add(k)
                keep.append(r)
        return keep

    out["items"], out["reported"] = dedupe(out["items"])[:12], dedupe(out["reported"])[:12]
    out["source"] = doc.wiki_path
    out["month"] = (doc.filed_at or date.today()).strftime("%Y-%m")
    if ok:  # never cache a failed read
        cp.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    return out


def write_ledger(brain: Brain, calls: list[dict]) -> None:
    lines = [f"# {brain.symbol} guidance ledger", "",
             "What management said it would do, quoted from its own concall transcripts.", ""]
    for c in calls:
        lines += [f"## {c.get('call') or c['month']} call ({c['month']}) · [[{c['source'][:-3]}]]", "",
                  "| Metric | Promise | Target | Horizon | Quote |", "|---|---|---|---|---|"]
        for it in c.get("items", []):
            q = (it.get("quote") or "").replace("|", "/")
            lines.append(f"| {it.get('metric', '')} | {it.get('statement', '')} | {it.get('target', '')} | "
                         f"{it.get('horizon', '')} | “{q}” (p{it.get('page', '?')}) |")
        if c.get("reported"):
            lines += ["", "Reported on this call:", ""]
            lines += [f"- {r.get('metric', '')}: {r.get('value', '')} (p{r.get('page', '?')})" for r in c["reported"]]
        lines.append("")
    brain.write_page("", "guidance-ledger", "\n".join(lines))


# ── trajectory (no model) ─────────────────────────────────────────────────


def quarterly_series(nse: NSE, symbol: str, n: int = 10) -> list[dict]:
    filings = nse.results_filings(symbol) or nse.results_filings(symbol, consolidated=False)
    rows = []
    for f in filings[:n]:
        try:
            h = parse_headline(nse.xbrl(f["xbrl"]))
        except Exception:
            continue
        rows.append({"period_end": h.period_end.isoformat(), "labels": list(h.labels), "revenue": h.revenue,
                     "ebitda": h.ebitda, "ebit": h.ebit, "pbt": h.pbt, "pat": h.pat, "is_bank": h.is_bank})
    by_end = {r["period_end"]: r for r in rows}
    for r in rows:
        y, m = _quarter_back(date.fromisoformat(r["period_end"]), 4)
        ago = next((v for k, v in by_end.items() if k.startswith(f"{y}-{m:02d}")), None)
        for f in ("revenue", "pat"):
            r[f"{f}_yoy"] = (round((r[f] - ago[f]) / abs(ago[f]) * 100, 1)
                             if ago and r[f] is not None and ago.get(f) else None)
        r["margin"] = round(r["ebitda"] / r["revenue"] * 100, 1) if r["revenue"] and r["ebitda"] and not r["is_bank"] else None
        r["op_margin"] = round(r["ebit"] / r["revenue"] * 100, 1) if r["revenue"] and r.get("ebit") and not r["is_bank"] else None
    return sorted(rows, key=lambda r: r["period_end"])


def write_trajectory(brain: Brain, series: list[dict]) -> None:
    if not series:
        return
    lab = series[-1]["labels"]
    lines = [f"# {brain.symbol} trajectory (quarterly, ₹ Cr)", "", "From NSE results filings (XBRL).", "",
             "EBITDA = PBT + finance costs + D&A − other income; operating (EBIT) margin = (EBITDA − D&A) / revenue.", "",
             f"| Quarter | {lab[0]} | {lab[0]} YoY | {lab[1]} | EBITDA margin | Operating margin | {lab[3]} | {lab[3]} YoY |",
             "|---|---:|---:|---:|---:|---:|---:|---:|"]

    def n(v):
        return "—" if v is None else f"{v:,.0f}"

    def p(v):
        return "—" if v is None else f"{v:+.1f}%"

    for r in series:
        lines.append(f"| {r['period_end']} | {n(r['revenue'])} | {p(r['revenue_yoy'])} | {n(r['ebitda'])} | "
                     f"{'—' if r['margin'] is None else str(r['margin']) + '%'} | "
                     f"{'—' if r.get('op_margin') is None else str(r['op_margin']) + '%'} | {n(r['pat'])} | {p(r['pat_yoy'])} |")
    brain.write_page("dossier", "trajectory", "\n".join(lines) + "\n")


# ── snapshot from the annual report ───────────────────────────────────────

SNAPSHOT_SYSTEM = (
    "From the annual-report pages below, describe the business for an investor. " + GROUNDING + " "
    'Return JSON: {"what_it_does": str (2 sentences), "segments": [{"name": str, "share": str '
    '(revenue share as stated, else "not stated"), "note": str}], "geographies": str, '
    '"key_facts": [str] (max 5, each with its number), "pages": [int]}. Cite page numbers you used.'
)

_SNAPSHOT_HINTS = re.compile(
    r"segment|business overview|about (the )?(company|us)|management discussion|md&a|revenue|highlights|at a glance|"
    r"our business|operating|portfolio|letter", re.I)


def snapshot(db: Session, brain: Brain, ar: Document) -> dict:
    md = (brain.wiki / ar.wiki_path).read_text(encoding="utf-8")
    pages = dict(_pages(md))
    wanted: list[int] = []
    tree_md = (brain.wiki / ar.tree_path).read_text(encoding="utf-8") if ar.tree_path else ""
    for line in tree_md.splitlines():
        m = re.search(r"- (.*?) \(p(\d+)(?:–(\d+))?\)", line)
        if m and _SNAPSHOT_HINTS.search(m.group(1)):
            a, b = int(m.group(2)), int(m.group(3) or m.group(2))
            wanted += list(range(a, min(b, a + 3) + 1))
    wanted = sorted(set(wanted))[:24] or list(range(1, 25))
    text = "\n".join(f"[p{p}] {pages.get(p, '')}" for p in wanted)[:60_000]
    key = hashlib.sha1(text.encode()).hexdigest()[:12]
    cp = _cache(brain, f"snapshot-{key}.json")
    if cp.exists():
        return json.loads(cp.read_text())
    out = llm.chat_json(SNAPSHOT_SYSTEM, text, feature="research_snapshot", db=db, models=CHEAP, max_tokens=5000) or {}
    out["source"] = ar.wiki_path
    cp.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    return out


def write_snapshot(brain: Brain, s: dict) -> None:
    if not s:
        return
    src = s.get("source", "")[:-3]
    lines = [f"# {brain.symbol} — what the business is", "", s.get("what_it_does", ""), ""]
    if s.get("segments"):
        lines += ["| Segment | Share | Note |", "|---|---|---|"]
        lines += [f"| {g.get('name', '')} | {g.get('share', '')} | {g.get('note', '')} |" for g in s["segments"]]
        lines.append("")
    if s.get("geographies"):
        lines += [f"**Geographies:** {s['geographies']}", ""]
    lines += [f"- {k}" for k in s.get("key_facts", [])]
    lines += ["", f"Source: [[{src}]] pages {', '.join(str(p) for p in s.get('pages', []))}"]
    brain.write_page("dossier", "snapshot", "\n".join(lines) + "\n")


# ── reasoning: promised vs delivered, bull vs bear ────────────────────────

PVD_SYSTEM = (
    "You audit management credibility for an investor: what management promised on each call versus what "
    "then happened. " + GROUNDING + " Evidence for 'what happened' comes from two places: (1) quarterly_actuals "
    "(from exchange filings; revenue, EBITDA margin, operating margin = EBIT margin, PAT, YoY), and (2) the "
    "'reported' lists of LATER calls (what management itself reported afterwards, e.g. segment growth, TCV). "
    "Companies' 'operating margin' means EBIT margin — compare it to op_margin, not EBITDA margin. "
    'Return JSON: {"verdict": str (2 sentences: overall credibility, specific), "score": "high"|"mixed"|"low", '
    '"rows": [{"call": str, "promise": str, "delivered": str (what happened, with figures and the quarter or '
    'later call it comes from), "status": "delivered"|"partly"|"missed"|"too early"|"not measurable", '
    '"cite": str}]}. Prefer promises that CAN be checked; use "too early" only when the promised period '
    "has not reported yet, and at most 2 'not measurable' rows. Cover every call that has promises, oldest "
    "first. Keep each cell under 25 words. 6-10 rows."
)

BULL_BEAR_SYSTEM = (
    "Write a tight bull and bear case for an investor from the dossier material below. " + GROUNDING + " "
    'Return JSON: {"bull": [{"point": str, "cite": str}], "bear": [{"point": str, "cite": str}], '
    '"watch": [str]}. 3 points each side, each under 30 words with a number where possible; '
    "cite the page (e.g. dossier/trajectory, guidance-ledger, transcripts/2026-10-concall). "
    "'watch' = 2-3 things that would change the view next quarter."
)


def promised_vs_delivered(db: Session, symbol: str, calls: list[dict], series: list[dict]) -> dict:
    material = json.dumps({"calls": [{k: c.get(k) for k in ("call", "month", "source", "items", "reported")} for c in calls],
                           "quarterly_actuals": series}, ensure_ascii=False)
    return llm.chat_json(PVD_SYSTEM, f"Company: {symbol}\n{material}", feature="research_pvd", db=db,
                         models=REASON, max_tokens=12000, effort=None) or {}


def bull_bear(db: Session, symbol: str, snap: dict, series: list[dict], pvd: dict) -> dict:
    material = json.dumps({"snapshot": snap, "quarterly_actuals": series, "promised_vs_delivered": pvd},
                          ensure_ascii=False)
    return llm.chat_json(BULL_BEAR_SYSTEM, f"Company: {symbol}\n{material}", feature="research_bullbear",
                         db=db, models=REASON, max_tokens=10000, effort=None) or {}


def write_pvd(brain: Brain, pvd: dict) -> None:
    if not pvd:
        return
    lines = [f"# {brain.symbol} — promised vs delivered", "", f"**{pvd.get('score', '').title()} credibility.** "
             f"{pvd.get('verdict', '')}", "", "| Call | Promise | Delivered | Status | Source |", "|---|---|---|---|---|"]
    for r in pvd.get("rows", []):
        lines.append(f"| {r.get('call', '')} | {r.get('promise', '')} | {r.get('delivered', '')} | "
                     f"{r.get('status', '')} | {r.get('cite', '')} |")
    brain.write_page("dossier", "promised-vs-delivered", "\n".join(lines) + "\n")


def write_bull_bear(brain: Brain, bb: dict) -> None:
    if not bb:
        return
    lines = [f"# {brain.symbol} — bull vs bear", "", "## Bull", ""]
    lines += [f"- {p['point']} ({p.get('cite', '')})" for p in bb.get("bull", [])]
    lines += ["", "## Bear", ""] + [f"- {p['point']} ({p.get('cite', '')})" for p in bb.get("bear", [])]
    if bb.get("watch"):
        lines += ["", "## Watch next quarter", ""] + [f"- {w}" for w in bb["watch"]]
    brain.write_page("dossier", "bull-bear", "\n".join(lines) + "\n")


# ── verification ──────────────────────────────────────────────────────────


def verify_dossier(brain: Brain, d: dict) -> dict:
    """Mark every figure in the generated sections as found / not found in the cited sources."""
    from finn_api.verify import check, series_values

    texts = []
    for rel in (d.get("sources") or {}).get("transcripts") or []:
        p = brain.wiki / rel
        if p.exists():
            texts.append(p.read_text(encoding="utf-8"))
    ar = (d.get("sources") or {}).get("annual_report")
    if ar and (brain.wiki / ar).exists():
        texts.append((brain.wiki / ar).read_text(encoding="utf-8"))
    extra = series_values(d.get("trajectory") or [])
    totals = {"checked": 0, "found": 0}

    def mark(obj: dict, *fields: str) -> None:
        c = check(" ".join(str(obj.get(f) or "") for f in fields), texts, extra)
        obj["verify"] = c.as_dict()
        totals["checked"] += c.checked
        totals["found"] += c.found

    for row in (d.get("promised_vs_delivered") or {}).get("rows") or []:
        mark(row, "promise", "delivered")
    for side in ("bull", "bear"):
        for pt in (d.get("bull_bear") or {}).get(side) or []:
            mark(pt, "point")
    snap = d.get("snapshot") or {}
    if snap.get("key_facts"):
        snap["key_facts_verify"] = [check(k, texts, extra).as_dict() for k in snap["key_facts"]]
        for v in snap["key_facts_verify"]:
            totals["checked"] += v["checked"]
            totals["found"] += v["found"]
    d["verification"] = totals
    return d


# ── orchestration ─────────────────────────────────────────────────────────


PROGRESS_FILE = "dossier/.progress.json"


def build_progress(brain: Brain) -> dict | None:
    """The running (or last) build's step and percent, written by build_dossier as it goes."""
    p = brain.wiki / PROGRESS_FILE
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return None


def build_dossier(db: Session, nse: NSE, symbol: str, *, refresh_docs: bool = True) -> dict:
    from datetime import UTC, datetime

    sym = symbol.upper()
    brain = Brain(sym)
    if not brain.exists:
        brain.scaffold()
    (brain.wiki / "dossier").mkdir(parents=True, exist_ok=True)
    started = datetime.now(UTC).isoformat()

    def progress(pct: float, step: str, state: str = "building") -> None:
        (brain.wiki / PROGRESS_FILE).write_text(json.dumps(
            {"state": state, "pct": round(pct, 2), "step": step, "started": started,
             "at": datetime.now(UTC).isoformat()}))

    try:
        return _build_dossier(db, nse, sym, brain, refresh_docs, progress)
    except Exception as e:
        progress(1.0, f"failed: {str(e)[:200]}", "failed")
        raise


_DOC_WORDS = {"transcript": "call transcript", "annual_report": "annual report", "presentation": "investor deck"}


def _build_dossier(db: Session, nse: NSE, sym: str, brain: Brain, refresh_docs: bool, progress) -> dict:
    from finn_api import ingest

    progress(0.03, "Finding the annual report and call transcripts")
    if refresh_docs:
        ingest.run_research_docs(db, nse, sym, on_doc=lambda i, n, d: progress(
            0.05 + 0.5 * i / max(n, 1), f"Reading the {_DOC_WORDS.get(d.doc_type or '', 'document')} ({i + 1} of {n})"))
    docs = db.scalars(select(Document).where(Document.symbol == sym, Document.status == "parsed")).all()
    seen_paths: set[str] = set()
    transcripts = []
    for d in sorted((d for d in docs if d.doc_type == "transcript" and d.wiki_path),
                    key=lambda d: (d.filed_at or date.min), reverse=True):
        if d.wiki_path in seen_paths or (d.sha256 and d.sha256 in seen_paths):
            continue
        seen_paths |= {d.wiki_path, d.sha256 or ""}
        transcripts.append(d)
        if len(transcripts) == 4:
            break
    ar = next((d for d in sorted(docs, key=lambda d: d.filed_at or date.min, reverse=True)
               if d.doc_type == "annual_report" and d.wiki_path), None)

    calls = []
    for i, d in enumerate(transcripts):
        progress(0.55 + 0.2 * i / max(len(transcripts), 1),
                 f"Extracting guidance from call {i + 1} of {len(transcripts)}")
        calls.append(extract_guidance(db, brain, d))
    calls.sort(key=lambda c: c["month"])
    write_ledger(brain, calls)
    progress(0.76, "Pulling quarterly results from NSE")
    series = quarterly_series(nse, sym)
    write_trajectory(brain, series)
    progress(0.8, "Reading the business from the annual report")
    snap = snapshot(db, brain, ar) if ar else {}
    write_snapshot(brain, snap)
    progress(0.86, "Checking each promise against what was delivered")
    pvd = promised_vs_delivered(db, sym, calls, series) if calls else {}
    write_pvd(brain, pvd)
    progress(0.94, "Writing the bull and bear case")
    bb = bull_bear(db, sym, snap, series, pvd)
    write_bull_bear(brain, bb)
    db.commit()

    dossier = {"symbol": sym, "built_on": date.today().isoformat(), "snapshot": snap, "trajectory": series,
               "guidance": calls, "promised_vs_delivered": pvd, "bull_bear": bb,
               "sources": {"transcripts": [d.wiki_path for d in transcripts], "annual_report": ar and ar.wiki_path}}
    dossier = verify_dossier(brain, dossier)
    (brain.wiki / "dossier" / "dossier.json").write_text(json.dumps(dossier, ensure_ascii=False, indent=1))
    brain.log(f"dossier built: {len(calls)} calls, {len(series)} quarters, AR={'yes' if ar else 'no'}")
    progress(1.0, "Ready", "ready")
    return dossier

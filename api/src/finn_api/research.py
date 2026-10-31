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
    "You extract management's explicit forward-looking statements from an Indian listed company's "
    "earnings-call transcript. " + GROUNDING + " "
    'Return JSON: {"call": "<quarter the call discusses, e.g. Q2 FY27>", "items": [{"metric": str '
    '(revenue growth, EBITDA margin, PAT, capex, order book, deal wins, volume, market share, other), '
    '"statement": str (what was promised, in plain words), "target": str (number/range as stated, or '
    '"directional"), "horizon": str (e.g. FY27, next quarter, medium term), "speaker": str, '
    '"quote": str (verbatim, <= 40 words), "page": int}]}. '
    "Include only statements about the future that could later be checked. Skip pleasantries, "
    "history, and analyst questions. At most 12 items, most important first."
)


def extract_guidance(db: Session, brain: Brain, doc: Document) -> dict:
    md = (brain.wiki / doc.wiki_path).read_text(encoding="utf-8")
    key = hashlib.sha1(md.encode()).hexdigest()[:12]
    cp = _cache(brain, f"guidance-{key}.json")
    if cp.exists():
        return json.loads(cp.read_text())
    out = llm.chat_json(GUIDANCE_SYSTEM, _with_page_marks(md, 90_000), feature="research_guidance",
                        db=db, models=CHEAP, max_tokens=6000) or {"items": []}
    out["source"] = doc.wiki_path
    out["month"] = (doc.filed_at or date.today()).strftime("%Y-%m")
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
                     "ebitda": h.ebitda, "pbt": h.pbt, "pat": h.pat, "is_bank": h.is_bank})
    by_end = {r["period_end"]: r for r in rows}
    for r in rows:
        y, m = _quarter_back(date.fromisoformat(r["period_end"]), 4)
        ago = next((v for k, v in by_end.items() if k.startswith(f"{y}-{m:02d}")), None)
        for f in ("revenue", "pat"):
            r[f"{f}_yoy"] = (round((r[f] - ago[f]) / abs(ago[f]) * 100, 1)
                             if ago and r[f] is not None and ago.get(f) else None)
        r["margin"] = round(r["ebitda"] / r["revenue"] * 100, 1) if r["revenue"] and r["ebitda"] and not r["is_bank"] else None
    return sorted(rows, key=lambda r: r["period_end"])


def write_trajectory(brain: Brain, series: list[dict]) -> None:
    if not series:
        return
    lab = series[-1]["labels"]
    lines = [f"# {brain.symbol} trajectory (quarterly, ₹ Cr)", "", "From NSE results filings (XBRL).", "",
             f"| Quarter | {lab[0]} | {lab[0]} YoY | {lab[1]} | Margin | {lab[3]} | {lab[3]} YoY |",
             "|---|---:|---:|---:|---:|---:|---:|"]

    def n(v):
        return "—" if v is None else f"{v:,.0f}"

    def p(v):
        return "—" if v is None else f"{v:+.1f}%"

    for r in series:
        lines.append(f"| {r['period_end']} | {n(r['revenue'])} | {p(r['revenue_yoy'])} | {n(r['ebitda'])} | "
                     f"{'—' if r['margin'] is None else str(r['margin']) + '%'} | {n(r['pat'])} | {p(r['pat_yoy'])} |")
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
    "You audit management credibility for an investor. Compare what management promised on its "
    "calls with what the reported numbers show. " + GROUNDING + " "
    'Return JSON: {"verdict": str (2 sentences: overall credibility), "score": "high"|"mixed"|"low", '
    '"rows": [{"call": str, "promise": str, "delivered": str (what the numbers show, with figures and '
    'quarter), "status": "delivered"|"partly"|"missed"|"too early"|"not measurable", "cite": str}]}. '
    "Use the quarterly table for actuals; a promise about a future period that hasn't reported yet is "
    '"too early". Keep each cell under 25 words. At most 10 rows, the most material first.'
)

BULL_BEAR_SYSTEM = (
    "Write a tight bull and bear case for an investor from the dossier material below. " + GROUNDING + " "
    'Return JSON: {"bull": [{"point": str, "cite": str}], "bear": [{"point": str, "cite": str}], '
    '"watch": [str]}. 3 points each side, each under 30 words with a number where possible; '
    "cite the page (e.g. dossier/trajectory, guidance-ledger, transcripts/2026-10-concall). "
    "'watch' = 2-3 things that would change the view next quarter."
)


def promised_vs_delivered(db: Session, symbol: str, calls: list[dict], series: list[dict]) -> dict:
    material = json.dumps({"calls": [{k: c.get(k) for k in ("call", "month", "source", "items")} for c in calls],
                           "quarterly_actuals": series}, ensure_ascii=False)
    return llm.chat_json(PVD_SYSTEM, f"Company: {symbol}\n{material}", feature="research_pvd", db=db,
                         models=REASON, max_tokens=8000) or {}


def bull_bear(db: Session, symbol: str, snap: dict, series: list[dict], pvd: dict) -> dict:
    material = json.dumps({"snapshot": snap, "quarterly_actuals": series, "promised_vs_delivered": pvd},
                          ensure_ascii=False)
    return llm.chat_json(BULL_BEAR_SYSTEM, f"Company: {symbol}\n{material}", feature="research_bullbear",
                         db=db, models=REASON, max_tokens=6000) or {}


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


# ── orchestration ─────────────────────────────────────────────────────────


def build_dossier(db: Session, nse: NSE, symbol: str, *, refresh_docs: bool = True) -> dict:
    from finn_api import ingest

    sym = symbol.upper()
    brain = Brain(sym)
    if not brain.exists:
        brain.scaffold()
    if refresh_docs:
        ingest.run_research_docs(db, nse, sym)
    docs = db.scalars(select(Document).where(Document.symbol == sym, Document.status == "parsed")).all()
    transcripts = sorted((d for d in docs if d.doc_type == "transcript" and d.wiki_path),
                         key=lambda d: d.filed_at or date.min, reverse=True)[:4]
    ar = next((d for d in sorted(docs, key=lambda d: d.filed_at or date.min, reverse=True)
               if d.doc_type == "annual_report" and d.wiki_path), None)

    calls = [extract_guidance(db, brain, d) for d in transcripts]
    calls.sort(key=lambda c: c["month"])
    write_ledger(brain, calls)
    series = quarterly_series(nse, sym)
    write_trajectory(brain, series)
    snap = snapshot(db, brain, ar) if ar else {}
    write_snapshot(brain, snap)
    pvd = promised_vs_delivered(db, sym, calls, series) if calls else {}
    write_pvd(brain, pvd)
    bb = bull_bear(db, sym, snap, series, pvd)
    write_bull_bear(brain, bb)
    db.commit()

    dossier = {"symbol": sym, "built_on": date.today().isoformat(), "snapshot": snap, "trajectory": series,
               "guidance": calls, "promised_vs_delivered": pvd, "bull_bear": bb,
               "sources": {"transcripts": [d.wiki_path for d in transcripts], "annual_report": ar and ar.wiki_path}}
    (brain.wiki / "dossier" / "dossier.json").write_text(json.dumps(dossier, ensure_ascii=False, indent=1))
    brain.log(f"dossier built: {len(calls)} calls, {len(series)} quarters, AR={'yes' if ar else 'no'}")
    return dossier

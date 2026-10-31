"""Filing PDFs → triage (Jev, rules fallback) → Chandra / pypdf → brain pages (+ PageIndex tree).

`finn cron ingest` runs this with no agent: deterministic apart from the Jev call.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import asdict
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from finn_api.brain import Brain
from finn_api.models import Document, FeedItem, LLMCall
from finn_api.sources import chandra, jev, pageindex, pdf
from finn_api.sources.nse import NSE

log = logging.getLogger("finn.ingest")

CORE = {"transcript", "results", "presentation", "annual_report"}
EVENT = {"press_release", "order_contract", "mna", "rating", "management_change", "legal_regulatory"}
CHANDRA_MAX_PAGES = 40
# OCR earns its cost on tables and slides; transcripts and prose read fine from the text layer.
CHANDRA_TYPES = {"presentation", "results", "annual_report", "rating", "order_contract", "mna"}
TREE_MIN_PAGES = 20

# Brain folder per doc type.
FOLDER = {
    "transcript": "transcripts",
    "annual_report": "annual-reports",
    "presentation": "presentations",
    "results": "results-docs",
}


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60] or "doc"


# ── triage ────────────────────────────────────────────────────────────────


def rules_triage(desc: str, category: str, first_pages: str, pages: int) -> dict:
    """Fallback when Jev is down or unsure. Conservative: only obvious core docs get parsed."""
    t = (first_pages or "").lower()
    if re.search(r"\bmoderator\b|conference call|earnings call transcript", t) and pages >= 5:
        doc_type = "transcript"
    elif "annual report" in t and pages >= 80:
        doc_type = "annual_report"
    elif desc == "Investor Presentation" or ("presentation" in t and pages >= 10):
        doc_type = "presentation"
    elif category == "results" or re.search(r"statement of (standalone|consolidated)? ?(un)?audited", t):
        doc_type = "results"
    elif category in ("meeting",):
        doc_type = "call_notice"
    elif category == "compliance":
        doc_type = "routine_compliance"
    else:
        doc_type = "other"
    return {"doc_type": doc_type, "doc_type_confidence": 0.5, "substantive": 0.5,
            "research_value": 1.0 if doc_type in CORE else 0.2}


NEVER = {"routine_compliance", "call_notice"}  # results ads etc. duplicate the real filing


def decide(tri: dict) -> str:
    dt, conf = tri["doc_type"], tri.get("doc_type_confidence", 0)
    if dt in NEVER and conf >= 0.6:
        return "store"
    if dt in CORE and conf >= 0.6:
        return "parse"
    if tri.get("research_value", 0) >= 0.45:
        return "parse"
    if dt in EVENT and tri.get("substantive", 0) >= 0.8:
        return "parse"
    return "store"


# ── pipeline ──────────────────────────────────────────────────────────────


def queue_new_documents(db: Session) -> int:
    """Every feed filing with a PDF becomes a Document row once."""
    n = 0
    seen = {(d.symbol, d.url) for d in db.scalars(select(Document))}
    for item in db.scalars(select(FeedItem).where(FeedItem.source_url.like("%.pdf"))):
        key = (item.symbol, item.source_url)
        if key in seen:
            continue
        seen.add(key)
        payload = json.loads(item.payload_json or "{}")
        db.add(Document(symbol=item.symbol, url=item.source_url, desc=payload.get("desc") or item.title,
                        filed_at=item.event_at))
        n += 1
    db.commit()
    return n


def _log_cost(db: Session, feature: str, model: str, tokens: int, cost: float) -> None:
    db.add(LLMCall(feature=feature, model=model, input_tokens=tokens, cost_usd=cost))


def process(
    db: Session, nse: NSE, doc: Document, *, allow_chandra: bool = True, force_parse: bool = False
) -> Document:
    brain = Brain(doc.symbol)
    if not brain.exists:
        brain.scaffold()
    try:
        raw = nse.get_archive(doc.url)
    except Exception as e:
        doc.status, doc.error = "failed", f"download: {e}"
        db.commit()
        return doc
    doc.sha256 = hashlib.sha256(raw).hexdigest()
    pdf_path = brain.raw / f"{doc.sha256[:16]}.pdf"
    if not pdf_path.exists():
        pdf_path.write_bytes(raw)

    # Same bytes filed twice (results PDF under "Outcome" and "Dividend") → reuse.
    twin = db.scalar(select(Document).where(Document.sha256 == doc.sha256, Document.id != doc.id,
                                            Document.status.in_(("parsed", "stored"))))
    if twin and not force_parse:
        doc.doc_type, doc.triage_json, doc.triage_by, doc.pages = twin.doc_type, twin.triage_json, "duplicate", twin.pages
        doc.decision, doc.status, doc.wiki_path, doc.tree_path = twin.decision, twin.status, twin.wiki_path, twin.tree_path
        db.commit()
        return doc

    try:
        raw = pdf.unwrap(raw)  # some NSE attachments are zips
        if not pdf_path.exists() or pdf_path.read_bytes()[:2] == b"PK":
            pdf_path.write_bytes(raw)
        page_texts, doc.pages = pdf.pages_text(raw)
    except Exception as e:
        doc.status, doc.error = "failed", f"pdf: {e}"
        db.commit()
        return doc

    # 1. triage
    first = "\n".join(page_texts[:2])[:6000]
    item = db.scalar(select(FeedItem).where(FeedItem.source_url == doc.url))
    category = item.category if item else ""
    state = (f"Exchange category: {doc.desc}\nExchange summary: {item.summary if item else ''}\n"
             f"File: {doc.url.rsplit('/', 1)[-1]}\nPages: {doc.pages}\n--- first pages ---\n{first}")
    t = None if doc.triage_by == "screener" else jev.classify_pdf(state)
    if doc.triage_by == "screener" and doc.doc_type:
        tri = {"doc_type": doc.doc_type, "doc_type_confidence": 1.0, "substantive": 1.0, "research_value": 1.0}
    elif t and t.doc_type_confidence >= 0.4:
        tri = asdict(t)
        doc.triage_by = "jev"
        _log_cost(db, "pdf_triage", jev.MODEL, t.input_tokens, t.cost_usd)
        doc.cost_usd += t.cost_usd
    else:
        tri = rules_triage(doc.desc or "", category, first, doc.pages)
        doc.triage_by = "rules"
    doc.doc_type = tri["doc_type"]
    doc.triage_by = doc.triage_by or "rules"
    doc.triage_json = json.dumps(tri)
    doc.decision = "parse" if force_parse else decide(tri)
    doc.status = "triaged"
    db.commit()

    if doc.decision != "parse":
        doc.status = "stored"
        db.commit()
        return doc

    # 2. convert: Chandra for normal-length docs, free text layer beyond the cap.
    when = (doc.filed_at or datetime.now(UTC)).strftime("%Y-%m-%d")
    name = f"{when}-{_slug(doc.doc_type)}-{doc.sha256[:6]}"
    if doc.triage_by == "screener":
        name = (f"annual-report-{when[:4]}" if doc.doc_type == "annual_report" else f"{when[:7]}-concall")
    folder = FOLDER.get(doc.doc_type, "filings/docs")
    scanned = sum(len(x) for x in page_texts[:3]) < 300
    md, engine = None, "pypdf"
    wants_ocr = scanned or (doc.doc_type in CHANDRA_TYPES and doc.pages <= CHANDRA_MAX_PAGES)
    if allow_chandra and chandra.available() and wants_ocr:
        try:
            md, cost, _ = chandra.to_markdown(pdf_path, max_pages=CHANDRA_MAX_PAGES)
            engine = "chandra"
            doc.cost_usd += cost
            _log_cost(db, "pdf_ocr", "datalab-chandra", 0, cost)
        except Exception as e:
            log.warning("chandra failed for %s: %s", doc.url, e)
            doc.error = f"chandra: {e}"
    if md is None:
        md = "\n\n".join(f'<a id="page-{i}"></a>\n## Page {i}\n\n{txt.strip()}'
                         for i, txt in enumerate(page_texts, 1))
    doc.engine = engine

    header = (f"# {doc.symbol} · {doc.desc} · {when}\n\n"
              f"- Type: **{doc.doc_type}** ({doc.triage_by}) · {doc.pages} pages · {engine}\n"
              f"- Filing: {doc.url}\n- Raw: `raw/{pdf_path.name}`\n\n---\n\n")
    page = brain.write_page(folder, name, header + md, source=doc.url)
    doc.wiki_path = str(page.relative_to(brain.wiki))

    # 3. PageIndex tree for long documents
    if doc.pages >= TREE_MIN_PAGES and pageindex.available():
        try:
            tree = pageindex.build_tree(pdf_path)
            text_page = doc.wiki_path[:-3]
            tp = brain.write_page(f"{folder}/trees", name,
                                  pageindex.tree_markdown(tree, title=f"{doc.symbol} {doc.desc} {when}",
                                                          text_page=text_page))
            (brain.root / "raw" / f"{doc.sha256[:16]}.tree.json").write_text(json.dumps(tree))
            doc.tree_path = str(tp.relative_to(brain.wiki))
        except Exception as e:
            log.warning("pageindex failed for %s: %s", doc.url, e)
            doc.error = ((doc.error or "") + f" pageindex: {e}")[:1000]

    doc.status = "parsed"
    brain.log(f"ingested {doc.doc_type} ({doc.pages}p, {engine}) → {doc.wiki_path}")
    db.commit()
    return doc


def run(db: Session, nse: NSE, *, limit: int = 10, allow_chandra: bool = True) -> list[Document]:
    queue_new_documents(db)
    todo = db.scalars(
        select(Document).where(Document.status == "new").order_by(Document.filed_at.desc()).limit(limit)
    ).all()
    return [process(db, nse, d, allow_chandra=allow_chandra) for d in todo]


def queue_research_docs(db: Session, symbol: str, *, transcripts: int = 4, annual_reports: int = 1) -> list[Document]:
    """The primary sources research needs, from screener's Documents section (PDFs on BSE /
    company IR): the latest annual report(s) and the last few concall transcripts."""
    from finn_api.sources import screener

    sym = symbol.upper()
    docs = screener.documents(sym)
    have = {d.url for d in db.scalars(select(Document).where(Document.symbol == sym))}
    queued: list[Document] = []
    seen_months: set[str] = set()
    picks: list[tuple[str, str, datetime, str]] = []
    for c in docs["concalls"]:
        if c["month"] in seen_months:
            continue
        seen_months.add(c["month"])
        y, m = map(int, c["month"].split("-"))
        picks.append(("transcript", c["transcript"], datetime(y, m, 1, tzinfo=UTC), f"Concall transcript {c['month']}"))
        if len(seen_months) >= transcripts:
            break
    for a in docs["annual_reports"][:annual_reports]:
        y = a.get("year") or datetime.now(UTC).year
        picks.append(("annual_report", a["url"], datetime(y, 7, 1, tzinfo=UTC), a.get("label") or f"Annual Report {y}"))
    for doc_type, url, when, desc in picks:
        if url in have:
            continue
        d = Document(symbol=sym, url=url, desc=desc, doc_type=doc_type, triage_by="screener", filed_at=when)
        db.add(d)
        queued.append(d)
    db.commit()
    return queued


def run_research_docs(db: Session, nse: NSE, symbol: str) -> list[Document]:
    """Queue and process one company's research documents now (text layer + PageIndex)."""
    queue_research_docs(db, symbol)
    todo = db.scalars(select(Document).where(Document.symbol == symbol.upper(), Document.triage_by == "screener",
                                             Document.status == "new")).all()
    return [process(db, nse, d, allow_chandra=False) for d in todo]


def parse_now(db: Session, nse: NSE, doc_id: str) -> Document:
    """App's "parse this" on a stored document: convert it regardless of triage."""
    doc = db.get(Document, doc_id)
    if doc is None:
        raise KeyError(doc_id)
    if doc.status == "parsed":
        return doc
    return process(db, nse, doc, force_parse=True)

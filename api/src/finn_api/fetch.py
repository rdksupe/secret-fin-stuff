"""On-demand fetching for the agent: any period of a company's exchange filings, and pulling
chosen filing PDFs (or older annual reports and concall transcripts) into its brain.

The crons keep the brain current going forward; these let FINN go back in time when a question
needs it ("compare with October 2019") without grepping the filesystem or writing scripts.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from finn_api import ingest
from finn_api.models import Document
from finn_api.sources import taxonomy
from finn_api.sources.nse import NSE

MAX_SPAN_DAYS = 366 * 3


def _when(ann: dict) -> datetime | None:
    raw = ann.get("sort_date") or ""
    try:
        return datetime.fromisoformat(raw).replace(tzinfo=UTC) - timedelta(hours=5, minutes=30)
    except ValueError:
        return None


def filings(db: Session, nse: NSE, symbol: str, start: date, end: date, query: str = "", limit: int = 60) -> list[dict]:
    """A company's NSE announcements between two dates (newest first), each with its category,
    PDF link, and where it already lives in the brain if FINN has read it."""
    sym = symbol.upper()
    if (end - start).days > MAX_SPAN_DAYS:
        start = end - timedelta(days=MAX_SPAN_DAYS)
    rows: list[dict] = []
    # NSE answers a year per call comfortably; walk longer spans a year at a time.
    a = start
    while a <= end:
        b = min(end, a + timedelta(days=365))
        rows += nse.announcements(symbol=sym, start=a, end=b)
        a = b + timedelta(days=1)
    have = {d.url: d for d in db.scalars(select(Document).where(Document.symbol == sym))}
    q = query.lower().split()
    out = []
    for r in rows:
        text = r.get("attchmntText") or ""
        cat = taxonomy.classify(r.get("desc", ""), text)
        hay = f"{r.get('desc', '')} {text}".lower()
        if q and not all(w in hay for w in q):
            continue
        url = r.get("attchmntFile") or None
        doc = have.get(url) if url else None
        when = _when(r)
        out.append({
            "date": when.date().isoformat() if when else r.get("an_dt"),
            "category": cat.label,
            "desc": r.get("desc", ""),
            "text": text[:300],
            "pdf": url,
            "ref": f"NSE {r.get('seq_id')}" if r.get("seq_id") else None,
            "in_brain": doc.wiki_path if doc and doc.status == "parsed" else None,
        })
    out.sort(key=lambda x: x["date"] or "", reverse=True)
    return out[:limit]


def ingest_urls(db: Session, nse: NSE, symbol: str, urls: list[str], doc_type: str | None = None) -> list[dict]:
    """Read these filing PDFs into the company's brain now (text layer; PageIndex tree when long)
    and report where each landed. Already-read documents are returned as they are."""
    sym = symbol.upper()
    out = []
    for url in urls[:12]:
        doc = db.scalar(select(Document).where(Document.symbol == sym, Document.url == url))
        if doc is None:
            doc = Document(symbol=sym, url=url, desc=doc_type or "Fetched filing", doc_type=doc_type,
                           triage_by="agent", filed_at=datetime.now(UTC))
            db.add(doc)
            db.commit()
        if doc.status != "parsed":
            ingest.process(db, nse, doc, allow_chandra=False, force_parse=True)
        out.append({"url": url, "status": doc.status, "page": doc.wiki_path and f"kb/companies/{sym}/wiki/{doc.wiki_path}",
                    "pages": doc.pages, "type": doc.doc_type, "error": doc.error})
    return out


def fetch_reports(db: Session, nse: NSE, symbol: str, annual_reports: int = 1, transcripts: int = 0) -> list[dict]:
    """Older primary sources from the company's documents index (screener → BSE / company IR):
    the last N annual reports and N concall transcripts, read into the brain."""
    sym = symbol.upper()
    ingest.queue_research_docs(db, sym, transcripts=max(0, min(transcripts, 12)), annual_reports=max(0, min(annual_reports, 8)))
    todo = db.scalars(select(Document).where(Document.symbol == sym, Document.triage_by == "screener",
                                             Document.status == "new")).all()
    for d in todo:
        ingest.process(db, nse, d, allow_chandra=False)
    docs = db.scalars(select(Document).where(Document.symbol == sym, Document.doc_type.in_(("annual_report", "transcript")))
                      .order_by(Document.filed_at.desc())).all()
    return [{"type": d.doc_type, "desc": d.desc, "date": d.filed_at and d.filed_at.date().isoformat(), "status": d.status,
             "page": d.wiki_path and f"kb/companies/{sym}/wiki/{d.wiki_path}", "pages": d.pages} for d in docs]

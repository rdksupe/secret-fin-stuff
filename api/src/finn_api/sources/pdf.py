"""PDF helpers shared by ingest, triage and the agent's filing-text tool.

NSE sometimes attaches a .zip instead of a PDF (e.g. auditor resignations) — unwrap it.
"""

from __future__ import annotations

import io
import logging
import re
import shutil
import subprocess
import tempfile
import zipfile

from pypdf import PdfReader

log = logging.getLogger("finn.pdf")

# Letterhead, exchange addresses and sign-off — noise for any classifier ("context rot").
BOILERPLATE = re.compile(
    r"exchange plaza|dalal street|phiroze|bandra|kurla|towers|dear sir|madam|scrip code|symbol\s*:|"
    r"\bisin\b|\bcin\b\s*[:\-]|\btel\b|e-?mail|website|www\.|kindly take|thanking you|"
    r"yours (faithfully|truly|sincerely)|company secretary|compliance officer|membership no|"
    r"regd\.? off|registered office|corporate office|listing (compliance|department)|the manager",
    re.I,
)


def unwrap(raw: bytes) -> bytes:
    """PDF bytes; if `raw` is a zip, the largest PDF inside it."""
    if raw[:2] != b"PK":
        return raw
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        pdfs = [i for i in z.infolist() if i.filename.lower().endswith(".pdf")]
        if not pdfs:
            raise ValueError("zip attachment contains no PDF")
        return z.read(max(pdfs, key=lambda i: i.file_size))


def pages_text(raw: bytes, limit: int | None = None) -> tuple[list[str], int]:
    """Per-page text. pypdf first; poppler's pdftotext when pypdf chokes (truncated streams,
    oversized content streams in 300-page annual reports)."""
    raw = unwrap(raw)
    try:
        reader = PdfReader(io.BytesIO(raw))
        pages = reader.pages if limit is None else reader.pages[:limit]
        return [(p.extract_text() or "") for p in pages], len(reader.pages)
    except Exception as e:
        texts = _pdftotext(raw, limit)
        if texts is None:
            raise
        log.info("pypdf failed (%s); used pdftotext for %d pages", e, len(texts))
        return texts, len(texts)


def _pdftotext(raw: bytes, limit: int | None) -> list[str] | None:
    if not shutil.which("pdftotext"):
        return None
    with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
        f.write(raw)
        f.flush()
        args = ["pdftotext", "-layout", "-q"] + (["-l", str(limit)] if limit else []) + [f.name, "-"]
        r = subprocess.run(args, capture_output=True, timeout=300)
    if r.returncode != 0 and not r.stdout:
        return None
    pages = r.stdout.decode("utf-8", errors="ignore").split("\f")
    return pages[:-1] if pages and not pages[-1].strip() else pages


def body(page_texts: list[str], max_chars: int = 2500) -> str:
    """Filing text with letterhead/addresses/sign-off stripped, whitespace collapsed."""
    lines = "\n".join(page_texts).splitlines()
    keep = [ln.strip() for ln in lines if len(ln.strip()) > 3 and not BOILERPLATE.search(ln)]
    return re.sub(r"\s+", " ", " ".join(keep))[:max_chars]

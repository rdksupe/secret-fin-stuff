"""PDF helpers shared by ingest, triage and the agent's filing-text tool.

NSE sometimes attaches a .zip instead of a PDF (e.g. auditor resignations) — unwrap it.
"""

from __future__ import annotations

import io
import re
import zipfile

from pypdf import PdfReader

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
    reader = PdfReader(io.BytesIO(unwrap(raw)))
    pages = reader.pages if limit is None else reader.pages[:limit]
    return [(p.extract_text() or "") for p in pages], len(reader.pages)


def body(page_texts: list[str], max_chars: int = 2500) -> str:
    """Filing text with letterhead/addresses/sign-off stripped, whitespace collapsed."""
    lines = "\n".join(page_texts).splitlines()
    keep = [ln.strip() for ln in lines if len(ln.strip()) > 3 and not BOILERPLATE.search(ln)]
    return re.sub(r"\s+", " ", " ".join(keep))[:max_chars]

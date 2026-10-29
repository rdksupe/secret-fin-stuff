"""Chandra OCR via the Datalab convert API (`mode=accurate`). PDF → markdown, with cost."""

from __future__ import annotations

import time
from pathlib import Path

import httpx

from finn_api.config import settings

CONVERT_URL = "https://www.datalab.to/api/v1/convert"


def available() -> bool:
    return bool(settings.datalab_api_key)


def to_markdown(pdf: Path, *, max_pages: int | None = None, timeout_s: int = 600) -> tuple[str, float, int]:
    """Returns (markdown, cost_usd, pages_processed). Raises on failure."""
    headers = {"X-API-Key": settings.datalab_api_key or ""}
    data = {
        "output_format": "markdown",
        "mode": settings.datalab_mode,
        "paginate": "true",
        "token_efficient_markdown": "true",
        "disable_image_extraction": "true",
    }
    if max_pages:
        data["max_pages"] = str(max_pages)
    with pdf.open("rb") as f, httpx.Client(timeout=120) as c:
        r = c.post(CONVERT_URL, headers=headers, files={"file": (pdf.name, f, "application/pdf")}, data=data)
        r.raise_for_status()
        check = r.json().get("request_check_url")
        if not check:
            raise RuntimeError(f"datalab: no request_check_url: {r.text[:200]}")
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            res = c.get(check, headers=headers).json()
            if res.get("status") == "complete":
                if not res.get("success", True):
                    raise RuntimeError(f"datalab failed: {res.get('error')}")
                cents = (res.get("cost_breakdown") or {}).get("final_cost_cents") or 0
                if not cents and isinstance(res.get("cost_breakdown"), dict):
                    cents = sum(v for v in res["cost_breakdown"].values() if isinstance(v, int | float))
                return (res.get("markdown") or "").strip(), float(cents) / 100, int(res.get("page_count") or 0)
            if res.get("status") == "failed":
                raise RuntimeError(f"datalab failed: {res.get('error')}")
            time.sleep(3)
    raise TimeoutError(f"datalab convert timed out after {timeout_s}s")

"""FINN tools for Hermes. Each runs the `finn` CLI with a fixed argv — never a shell string."""

from __future__ import annotations

import json
import os
import re
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path

_SYMBOL = re.compile(r"^[A-Z0-9&\-]{1,20}$")


def _repo() -> Path:
    return Path(os.environ.get("FINN_REPO") or Path.home() / "building_shit" / "finn")


def _finn(*args: str, timeout: int = 300) -> str:
    r = subprocess.run(
        ["uv", "run", "--project", str(_repo() / "api"), "finn", *args],
        capture_output=True, text=True, timeout=timeout,
    )
    if r.returncode != 0:
        return json.dumps({"ok": False, "error": (r.stderr or r.stdout)[-800:]})
    return r.stdout.strip()[-60000:]


def _symbols(raw) -> list[str]:
    items = raw if isinstance(raw, list) else re.split(r"[\s,]+", str(raw or ""))
    out = [s.strip().upper() for s in items if s and s.strip()]
    bad = [s for s in out if not _SYMBOL.match(s)]
    if bad:
        raise ValueError(f"not NSE symbols: {bad}")
    return out


def _err(msg: str) -> str:
    return json.dumps({"ok": False, "error": msg})


def digest(args: dict, **_kw) -> str:
    hours = int(args.get("hours") or 24)
    return _finn("digest", "--hours", str(max(1, min(hours, 24 * 90))))


def results(args: dict, **_kw) -> str:
    try:
        (sym,) = _symbols(args.get("symbol"))[:1] or [""]
    except ValueError as e:
        return _err(str(e))
    return _finn("results", sym) if sym else _err("symbol is required")


def onboard(args: dict, **_kw) -> str:
    try:
        syms = _symbols(args.get("symbols"))
    except ValueError as e:
        return _err(str(e))
    if not syms:
        return _err("symbols is required")
    argv = ["onboard", *syms[:25]]
    weights = args.get("weights") or {}
    if isinstance(weights, dict) and weights:
        argv += ["--weights", ",".join(f"{k.upper()}={float(v)}" for k, v in weights.items())]
    return _finn(*argv, timeout=900)


def filing_text(args: dict, **_kw) -> str:
    url = str(args.get("url") or "")
    pages = str(max(1, min(int(args.get("pages") or 3), 10)))
    return _finn("pdftext", url, "--pages", pages) if url.startswith("https://") else _err("https url required")


def dossier(args: dict, **_kw) -> str:
    try:
        (sym,) = _symbols(args.get("symbol"))[:1] or [""]
    except ValueError as e:
        return _err(str(e))
    if not sym:
        return _err("symbol is required")
    page = _repo() / "kb" / "companies" / sym / "wiki" / "dossier" / "dossier.json"
    if page.exists() and not args.get("rebuild"):
        d = json.loads(page.read_text())
        # The guidance ledger is ~28k chars of verbatim quotes; the model gets it only on request
        # (it is also kb/companies/{SYM}/wiki/guidance-ledger.md, and finn_brain_search finds lines in it).
        if not args.get("include_guidance"):
            d["guidance"] = f"omitted; read kb/companies/{sym}/wiki/guidance-ledger.md or pass include_guidance"
        return json.dumps(d, ensure_ascii=False)[:60000]
    return _finn("dossier", sym, timeout=1800)


def _api(path: str, params: dict) -> str:
    base = (os.environ.get("FINN_APP_API_URL") or "http://127.0.0.1:8000").rstrip("/")
    req = urllib.request.Request(f"{base}{path}?{urllib.parse.urlencode(params)}",
                                 headers={"X-API-Key": os.environ.get("FINN_API_KEY", "")})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode()


def portfolio(args: dict, **_kw) -> str:
    try:
        return json.loads(_api("/api/portfolio", {}))["markdown"]
    except Exception as e:
        return _err(f"portfolio lookup failed: {e}")


def brain_search(args: dict, **_kw) -> str:
    q = str(args.get("query") or "").strip()
    if not q:
        return _err("query is required")
    try:
        syms = _symbols(args.get("symbols") or [])
    except ValueError as e:
        return _err(str(e))
    try:
        hits = json.loads(_api("/api/brain/search", {"q": q, "symbols": ",".join(syms), "limit": int(args.get("limit") or 15)}))
    except Exception as e:
        return _err(f"brain search failed: {e}")
    return json.dumps([{"symbol": h["symbol"], "page": f"kb/companies/{h['symbol']}/wiki/{h['path']}",
                        "section": h["section"], "passage": h["snippet"].replace("«", "").replace("»", "")}
                       for h in hits], ensure_ascii=False)


def enrich(args: dict, **_kw) -> str:
    feed_id = str(args.get("feed_id") or "")
    if not re.fullmatch(r"[0-9a-f\-]{36}", feed_id):
        return _err("feed_id must be the uuid from the cron input")
    argv = ["enrich", feed_id]
    if args.get("summary"):
        argv += ["--summary", str(args["summary"])[:200]]
    if args.get("importance") is not None:
        argv += ["--importance", str(max(0.0, min(1.0, float(args["importance"]))))]
    if args.get("person"):
        person = args["person"] if isinstance(args["person"], dict) else json.loads(args["person"])
        argv += ["--person", json.dumps(person, ensure_ascii=False)]
    return _finn(*argv)


S = {"type": "string"}
SCHEMAS = {
    "finn_digest": {
        "description": "Ranked digest of the investor's portfolio filings and EOD moves for the last N hours: "
                       "alert / brief / list stories plus collapsed routine counts.",
        "parameters": {"type": "object", "properties": {"hours": {"type": "integer", "description": "window, default 24"}}},
    },
    "finn_results": {
        "description": "Latest quarterly results for an NSE symbol from XBRL: Revenue/EBITDA/PBT/PAT "
                       "(banks: NII/PPOP/PBT/PAT) with QoQ, YoY and red flags.",
        "parameters": {"type": "object", "properties": {"symbol": S}, "required": ["symbol"]},
    },
    "finn_onboard": {
        "description": "Add NSE symbols to the portfolio (or create a brain for research): scaffold the company "
                       "brain, backfill 30 days of filings and latest results.",
        "parameters": {"type": "object", "properties": {
            "symbols": {"type": "array", "items": S},
            "weights": {"type": "object", "description": "optional {SYMBOL: portfolio %}"},
        }, "required": ["symbols"]},
    },
    "finn_filing_text": {
        "description": "Text of the first pages of an NSE/BSE filing PDF (the `pdf` field of a feed item). "
                       "Use when the exchange summary is a stub.",
        "parameters": {"type": "object", "properties": {"url": S, "pages": {"type": "integer"}}, "required": ["url"]},
    },
    "finn_portfolio": {
        "description": "The investor's current holdings (symbol, company, industry, weight), watch-only names "
                       "and alert thresholds, read live. Call this for any question about 'my portfolio', "
                       "'my companies' or 'my stocks' instead of listing kb/companies/ (which also holds "
                       "companies they only researched).",
        "parameters": {"type": "object", "properties": {}},
    },
    "finn_brain_search": {
        "description": "Full-text search across company brains (annual reports, concall transcripts, results, "
                       "filings, dossiers). Returns the best-matching passages with their page path and section "
                       "(e.g. 'Page 44'). Use this FIRST for any question about what companies said or disclosed, "
                       "including cross-portfolio questions ('which of my companies are exposed to X'). Then "
                       "read_file the cited page only if you need more context.",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string", "description": "a few keywords, e.g. 'data center capex'"},
            "symbols": {"type": "array", "items": S, "description": "limit to these NSE symbols; omit for all"},
            "limit": {"type": "integer", "description": "passages to return, default 15"},
        }, "required": ["query"]},
    },
    "finn_dossier": {
        "description": "Grounded research dossier for an NSE symbol, built only from its annual report, last 4 "
                       "concall transcripts and NSE results: snapshot, quarterly trajectory, guidance ledger, "
                       "promised-vs-delivered audit, bull/bear. Builds it (a few minutes) if missing.",
        "parameters": {"type": "object", "properties": {"symbol": S, "rebuild": {"type": "boolean"},
                                                        "include_guidance": {"type": "boolean"}},
                       "required": ["symbol"]},
    },
    "finn_enrich": {
        "description": "Write enrichment back to a FINN feed item: a ≤160-char 'what changed and why it matters' "
                       "line, importance 0–1, and for management changes the person's bio. Releases the held push.",
        "parameters": {"type": "object", "properties": {
            "feed_id": S,
            "summary": S,
            "importance": {"type": "number"},
            "person": {"type": "object", "properties": {
                "name": S, "role": S, "change": S, "bio": S,
                "sources": {"type": "array", "items": S},
            }},
        }, "required": ["feed_id", "summary"]},
    },
}
HANDLERS = {"finn_portfolio": portfolio, "finn_brain_search": brain_search, "finn_dossier": dossier, "finn_filing_text": filing_text, "finn_digest": digest, "finn_results": results, "finn_onboard": onboard, "finn_enrich": enrich}


def register(ctx) -> None:
    for name, schema in SCHEMAS.items():
        ctx.register_tool(name=name, toolset="finn", schema={"name": name, **schema},
                          handler=HANDLERS[name], emoji="📈")

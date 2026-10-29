"""Per-company brain: `kb/companies/{SYMBOL}/{raw,wiki}` — FieldClaw's site wiki, for a stock.

Karpathy-style LLM wiki, no embeddings. Raw sources stay immutable under `raw/`;
`wiki/` holds compiled markdown the agent (and the app) reads by walking
`index.md`. Every page cites the raw file or URL it came from.

Folders are scaffolded at onboarding. Writers here are deterministic (filings,
results, people, news); LLM-compiled pages (profile, guidance ledger, dossier)
are written by the Hermes `finn` skills through the same `write_page`.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from pathlib import Path

from finn_api.config import settings

FOLDERS = (
    "filings",  # monthly digest of every announcement, one line each
    "results",  # one page per quarter, from XBRL
    "transcripts",  # concall transcripts → markdown (Chandra)
    "annual-reports",  # annual reports → markdown + PageIndex tree
    "people",  # management + incoming-person bios
    "news",  # push-side context only; never cited in research
    "dossier",  # compiled research sections (pull)
)


def _slug(text: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower() or "page"


class Brain:
    def __init__(self, symbol: str, root: Path | None = None):
        self.symbol = symbol.upper()
        self.root = (root or settings.finn_kb_dir) / "companies" / self.symbol
        self.raw = self.root / "raw"
        self.wiki = self.root / "wiki"

    @classmethod
    def all(cls, root: Path | None = None) -> list[Brain]:
        base = (root or settings.finn_kb_dir) / "companies"
        if not base.is_dir():
            return []
        return [cls(p.name, root) for p in sorted(base.iterdir()) if (p / "wiki").is_dir()]

    @property
    def exists(self) -> bool:
        return (self.wiki / "index.md").exists()

    def scaffold(self, *, name: str | None = None, industry: str | None = None) -> list[str]:
        created = []
        self.raw.mkdir(parents=True, exist_ok=True)
        for f in FOLDERS:
            d = self.wiki / f
            if not d.exists():
                d.mkdir(parents=True)
                created.append(f)
        profile = self.wiki / "profile.md"
        if not profile.exists():
            profile.write_text(
                f"# {name or self.symbol}\n\n"
                f"- NSE: `{self.symbol}`\n"
                + (f"- Industry: {industry}\n" if industry else "")
                + "\nBusiness description is compiled from the latest annual report "
                "once it is ingested.\n",
                encoding="utf-8",
            )
            created.append("profile.md")
        ledger = self.wiki / "guidance-ledger.md"
        if not ledger.exists():
            ledger.write_text(
                f"# {self.symbol} guidance ledger\n\n"
                "What management explicitly guided, per quarter, quoted from concall "
                "transcripts — and what was delivered.\n",
                encoding="utf-8",
            )
            created.append("guidance-ledger.md")
        self.log("brain scaffolded")
        self.rebuild_index()
        return created

    # ── writing ────────────────────────────────────────────────────────────

    def write_page(self, folder: str, name: str, body: str, *, source: str | None = None) -> Path:
        d = self.wiki / folder
        d.mkdir(parents=True, exist_ok=True)
        path = d / f"{_slug(name)}.md"
        if source and "Source:" not in body:
            body = body.rstrip() + f"\n\nSource: {source}\n"
        path.write_text(body, encoding="utf-8")
        self.rebuild_index()
        return path

    def append_filing(self, ann: dict, category_label: str, tier: int) -> bool:
        """One line per announcement in `filings/YYYY-MM.md`. Returns False if already there."""
        seq = str(ann.get("seq_id") or ann.get("seqId") or "")
        when = ann.get("sort_date") or ann.get("an_dt") or ""
        month = when[:7] if re.match(r"\d{4}-\d{2}", when) else datetime.now(UTC).strftime("%Y-%m")
        path = self.wiki / "filings" / f"{month}.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        existing = path.read_text(encoding="utf-8") if path.exists() else f"# {self.symbol} filings {month}\n\n"
        if seq and f"<!-- {seq} -->" in existing:
            return False
        text = re.sub(r"\s+", " ", ann.get("attchmntText") or "").strip()
        line = (
            f"- {when[:16]} · **{category_label}** (t{tier}) · {ann.get('desc', '')} — "
            f"{text[:280]}"
            + (f" [pdf]({ann['attchmntFile']})" if ann.get("attchmntFile") else "")
            + (f" <!-- {seq} -->" if seq else "")
            + "\n"
        )
        path.write_text(existing + line, encoding="utf-8")
        return True

    def log(self, message: str) -> None:
        self.wiki.mkdir(parents=True, exist_ok=True)
        path = self.wiki / "log.md"
        head = "" if path.exists() else f"# {self.symbol} log\n\n"
        stamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
        with path.open("a", encoding="utf-8") as f:
            f.write(f"{head}- {stamp} — {message}\n")

    # ── reading ────────────────────────────────────────────────────────────

    def rebuild_index(self) -> None:
        lines = [f"# {self.symbol} brain", "", "Start here. Pages are plain markdown; follow the links.", ""]
        for top in ("profile.md", "guidance-ledger.md", "log.md"):
            if (self.wiki / top).exists():
                lines.append(f"- [[{top[:-3]}]]")
        lines.append("")
        for folder in FOLDERS:
            pages = sorted((self.wiki / folder).glob("*.md"), reverse=True) if (self.wiki / folder).is_dir() else []
            if not pages:
                continue
            lines += [f"## {folder}/", ""]
            for md in pages[:40]:
                first = md.read_text(encoding="utf-8", errors="replace").split("\n", 1)[0]
                lines.append(f"- [[{folder}/{md.stem}]] — {first.lstrip('# ').strip()}")
            if len(pages) > 40:
                lines.append(f"- … {len(pages) - 40} older pages in `{folder}/`")
            lines.append("")
        (self.wiki / "index.md").write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")

    def read(self, rel: str) -> str:
        path = (self.wiki / rel).resolve()
        if not path.is_relative_to(self.wiki.resolve()):
            raise ValueError("path escapes brain")
        if path.suffix != ".md":
            path = path.with_suffix(".md")
        return path.read_text(encoding="utf-8")

    def pages(self) -> list[str]:
        if not self.wiki.is_dir():
            return []
        return sorted(str(p.relative_to(self.wiki)) for p in self.wiki.rglob("*.md"))

"""PageIndex Flash tree for long PDFs — layout + embedded bookmarks, no LLM.

Runs in the PageIndex clone's own venv (litellm/pypdfium2 pins) via subprocess.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from finn_api.config import settings

_RUNNER = """
import json, sys
from pageindex.flash import page_index_flash
tree = page_index_flash(sys.argv[1], summary=False)
json.dump(tree, sys.stdout)
"""


def available() -> bool:
    return (settings.pageindex_root / ".venv" / "bin" / "python").is_file()


def build_tree(pdf: Path, timeout: int = 600) -> dict:
    root = settings.pageindex_root
    env = os.environ.copy() | {"PYTHONPATH": str(root)}
    r = subprocess.run(
        [str(root / ".venv" / "bin" / "python"), "-c", _RUNNER, str(pdf)],
        cwd=root, env=env, capture_output=True, text=True, timeout=timeout,
    )
    if r.returncode != 0:
        raise RuntimeError(f"pageindex failed: {r.stderr[-600:]}")
    return json.loads(r.stdout)


def tree_markdown(tree: dict, *, title: str, text_page: str) -> str:
    """Outline with page ranges, each linking to the page anchor in the full-text page."""
    lines = [f"# {title} — structure", "", f"Full text: [[{text_page}]]", ""]

    def walk(nodes: list[dict], depth: int) -> None:
        for n in nodes:
            s, e = n.get("start_index"), n.get("end_index")
            pages = f"p{s}" if s == e else f"p{s}–{e}"
            lines.append(f"{'  ' * depth}- {n.get('title', '').strip()} ({pages}) [[{text_page}#page-{s}]]")
            walk(n.get("nodes") or [], depth + 1)

    walk(tree.get("structure") or [], 0)
    return "\n".join(lines) + "\n"

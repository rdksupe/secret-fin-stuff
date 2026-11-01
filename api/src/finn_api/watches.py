"""The investor's scheduled watches: Hermes cron jobs, their run history, pause / resume / delete.

Hermes owns the jobs (`$HERMES_HOME/cron/jobs.json`) and writes every run to
`$HERMES_HOME/cron/output/{job_id}/{YYYY-MM-DD_HH-MM-SS}.md`. This module reads those files and
drives changes through Hermes's own CLI, so the scheduler stays the single writer of jobs.json.
FINN's system jobs (`finn-*`: announcements, EOD, ingest) are not shown.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from finn_api.auth import require_auth

router = APIRouter(prefix="/api", dependencies=[Depends(require_auth)])

HERMES_HOME = Path(os.getenv("FINN_HERMES_HOME", str(Path.home() / ".hermes-finn")))
HERMES_BIN = os.getenv("FINN_HERMES_BIN", "/opt/hermes-agent/.venv/bin/hermes")
_ID = re.compile(r"^[0-9a-f]{6,32}$")
_RUN = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$")
_DAYS = {"1-5": "Weekdays", "0,6": "Weekends", "6,0": "Weekends", "*": "Daily"}
_DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]


def _jobs() -> list[dict]:
    try:
        d = json.loads((HERMES_HOME / "cron" / "jobs.json").read_text())
    except (OSError, ValueError):
        return []
    jobs = d.get("jobs", []) if isinstance(d, dict) else d
    return [j for j in jobs if isinstance(j, dict) and not str(j.get("name", "")).startswith("finn-")]


def _job(job_id: str) -> dict:
    if not _ID.match(job_id):
        raise HTTPException(400, "bad job id")
    for j in _jobs():
        if j.get("id") == job_id:
            return j
    raise HTTPException(404, "no such watch")


def human_schedule(expr: str) -> str:
    """'30 8 * * 1-5' → 'Weekdays 08:30'. Anything unusual is shown as written."""
    parts = (expr or "").split()
    if len(parts) != 5:
        return expr or "—"
    mi, hr, dom, mon, dow = parts
    if mi.startswith("*/") and hr == "*" and dom == mon == dow == "*":
        return f"Every {mi[2:]} min"
    if not (mi.isdigit() and hr.isdigit() and dom == "*" and mon == "*"):
        return expr
    at = f"{int(hr):02d}:{int(mi):02d}"
    if dow in _DAYS:
        return f"{_DAYS[dow]} {at}"
    if dow.isdigit() and int(dow) < 7:
        return f"{_DOW[int(dow)]}s {at}"
    return f"{expr}"


def _summary(j: dict) -> dict:
    sched = j.get("schedule") or {}
    expr = sched.get("expr") if isinstance(sched, dict) else str(sched)
    runs = _run_files(j["id"])
    return {
        "id": j["id"],
        "name": j.get("name") or "Watch",
        "schedule": human_schedule(expr or j.get("schedule_display") or ""),
        "cron": expr or j.get("schedule_display"),
        "enabled": bool(j.get("enabled", True)) and j.get("state") != "paused",
        "state": j.get("state"),
        "next_run_at": j.get("next_run_at"),
        "last_run_at": j.get("last_run_at"),
        "last_status": j.get("last_status"),
        "last_error": j.get("last_error") or j.get("last_delivery_error"),
        "chat_id": (j.get("origin") or {}).get("chat_id"),
        "script_only": bool(j.get("no_agent")),
        "prompt": _instruction(j.get("prompt") or ""),
        "runs": len(runs),
        "created_at": j.get("created_at"),
    }


def _instruction(prompt: str) -> str:
    # Hermes prepends its own cron boilerplate in brackets; show the investor's instruction only.
    return re.sub(r"^\s*\[IMPORTANT:.*?\]\s*", "", prompt, flags=re.S).strip()[:600]


def _run_files(job_id: str) -> list[Path]:
    d = HERMES_HOME / "cron" / "output" / job_id
    if not d.is_dir():
        return []
    return sorted((p for p in d.iterdir() if _RUN.match(p.name)), reverse=True)


def _parse_run(p: Path) -> dict:
    text = p.read_text(errors="ignore")
    m = re.search(r"^## Response\s*\n(.*)", text, flags=re.S | re.M)
    response = (m.group(1) if m else text).strip()
    at = datetime.strptime(p.stem, "%Y-%m-%d_%H-%M-%S").isoformat()
    silent = response.strip() == "[SILENT]"
    return {"id": p.stem, "at": at, "silent": silent, "response": "" if silent else response}


@router.get("/watches")
def list_watches():
    out = [_summary(j) for j in _jobs()]
    out.sort(key=lambda w: (not w["enabled"], w["next_run_at"] or "9"))
    return out


@router.get("/watches/{job_id}")
def get_watch(job_id: str, limit: int = 30):
    j = _job(job_id)
    runs = []
    for p in _run_files(job_id)[: max(1, min(limit, 100))]:
        r = _parse_run(p)
        r["preview"] = r.pop("response")[:240]
        runs.append(r)
    return {**_summary(j), "runs_list": runs}


@router.get("/watches/{job_id}/runs/{run_id}")
def get_run(job_id: str, run_id: str):
    _job(job_id)
    p = HERMES_HOME / "cron" / "output" / job_id / f"{run_id}.md"
    if not _RUN.match(p.name) or not p.exists():
        raise HTTPException(404, "no such run")
    return _parse_run(p)


def _cli(*args: str) -> None:
    env = {**os.environ, "HERMES_HOME": str(HERMES_HOME)}
    r = subprocess.run([HERMES_BIN, "cron", *args], capture_output=True, text=True, timeout=60, env=env)
    if r.returncode != 0:
        raise HTTPException(502, f"hermes cron {args[0]} failed: {(r.stderr or r.stdout)[-200:]}")


@router.post("/watches/{job_id}/pause")
def pause_watch(job_id: str):
    _job(job_id)
    _cli("pause", job_id)
    return _summary(_job(job_id))


@router.post("/watches/{job_id}/resume")
def resume_watch(job_id: str):
    _job(job_id)
    _cli("resume", job_id)
    return _summary(_job(job_id))


@router.post("/watches/{job_id}/run")
def run_watch_now(job_id: str):
    _job(job_id)
    _cli("run", job_id)
    return {"ok": True}


@router.delete("/watches/{job_id}")
def delete_watch(job_id: str):
    _job(job_id)
    _cli("remove", job_id)
    return {"ok": True}

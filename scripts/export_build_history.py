#!/usr/bin/env python3
"""Export a Claude Code session transcript as a cleaned, redacted build history.

  python scripts/export_build_history.py SESSION.jsonl docs/build-history/claude-code-session.md

Keeps the human prompts, the assistant's replies and a one-line summary of every tool
call; truncates tool output; drops system reminders and internal bookkeeping entries.
Secrets are removed twice over: exact values gathered from local env/key files, plus
patterns (API keys, JWTs, private keys, OAuth codes, OCIDs, emails). The script refuses
to write if any known secret value survives.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HOME = Path.home()
SECRET_FILES = [
    HOME / "building_shit/finn/.env",
    HOME / ".hermes-finn/.env",
    HOME / ".hermes-fieldclaw/.env",
    Path("/run/media/rdksupe/finn/.finn-app-token"),
]
SECRET_KEYS = re.compile(r"(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)", re.I)
PATTERNS = [
    (re.compile(r"-----BEGIN [A-Z ]+-----.*?-----END [A-Z ]+-----", re.S), "[private key]"),
    (re.compile(r"eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}"), "[jwt]"),
    (re.compile(r"\bfw_[A-Za-z0-9]{8,}"), "[fireworks key]"),
    (re.compile(r"\bapikey_[A-Za-z0-9_]{16,}"), "[typesafe key]"),
    (re.compile(r"\bsk-[A-Za-z0-9_-]{16,}"), "[api key]"),
    (re.compile(r"\btvly-[A-Za-z0-9_-]{8,}"), "[api key]"),
    (re.compile(r"\b4/0A[\w-]{20,}"), "[oauth code]"),
    (re.compile(r"\bAIza[\w-]{30,}"), "[google api key]"),
    (re.compile(r"ocid1\.[a-z]+\.oc1\.[\w.-]*?[a-z0-9]{40,}"), "[ocid]"),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[email]"),
    (re.compile(r"\byard-[0-9a-f]{4}-[0-9a-f]{4}\b"), "[password]"),
]
IST = timezone(timedelta(hours=5, minutes=30))


def known_secrets() -> set[str]:
    vals: set[str] = set()
    for f in SECRET_FILES:
        if not f.exists():
            continue
        text = f.read_text(errors="ignore").strip()
        if "=" not in text:  # a bare token file
            vals.add(text)
            continue
        for line in text.splitlines():
            k, _, v = line.partition("=")
            v = v.strip().strip("'\"")
            if SECRET_KEYS.search(k) and len(v) >= 12:
                vals.add(v)
    pi = HOME / ".pi/web-search.json"
    if pi.exists():
        v = json.loads(pi.read_text()).get("exaApiKey")
        if v:
            vals.add(v)
    sa = Path("/run/media/rdksupe/finn/.secrets/fcm-sa.json")
    if sa.exists():
        k = json.loads(sa.read_text())
        vals |= {k.get("private_key_id", ""), k.get("private_key", "")}
    return {v for v in vals if len(v) >= 12}


def redact(text: str, secrets: set[str]) -> str:
    for v in sorted(secrets, key=len, reverse=True):
        if v in text:
            text = text.replace(v, "[redacted]")
            # also catch partial leaks (first 12 chars printed in a log)
        if len(v) > 16 and v[:12] in text:
            text = text.replace(v[:12], "[redacted]")
    for pat, repl in PATTERNS:
        text = pat.sub(repl, text)
    return text


def clip(text: str, lines: int = 14, chars: int = 1400) -> str:
    out = "\n".join(text.splitlines()[:lines])
    if len(out) > chars:
        out = out[:chars]
    if out != text:
        out += "\n… (truncated)"
    return out


def strip_reminders(text: str) -> str:
    text = re.sub(r"<system-reminder>.*?</system-reminder>", "", text, flags=re.S)
    text = re.sub(r"<(task-notification|bash-input|bash-stdout|bash-stderr)>.*?</\1>",
                  lambda m: "" if m.group(1) == "task-notification" else m.group(0), text, flags=re.S)
    return text.strip()


def tool_line(block: dict) -> str:
    name = block.get("name", "tool")
    inp = block.get("input") or {}
    if name == "Bash":
        desc = inp.get("description") or ""
        cmd = (inp.get("command") or "").strip().splitlines()[0][:160]
        return f"`Bash` — {desc}  \n  `{cmd}`"
    if name in ("Write", "Edit", "Read"):
        return f"`{name}` {inp.get('file_path', '')}"
    if name.startswith("mcp__"):
        short = name.split("__")[-1]
        arg = inp.get("url") or inp.get("text") or inp.get("uid") or ""
        return f"`{short}` {str(arg)[:120]}"
    if name in ("WebFetch", "WebSearch"):
        return f"`{name}` {inp.get('url') or inp.get('query', '')}"
    if name == "AskUserQuestion":
        qs = [q.get("question", "") for q in inp.get("questions", [])]
        return "`AskUserQuestion` " + " / ".join(qs)
    return f"`{name}`"


def render(session: Path, secrets: set[str]) -> str:
    out = [
        "# FINN — Claude Code build history (cleaned)",
        "",
        "The complete working session in which FINN was planned and built with Claude Code.",
        "Human prompts and assistant replies are verbatim; every tool call is shown as one line;",
        "tool output is truncated; system reminders are removed; secrets are redacted.",
        "Times are IST.",
        "",
    ]
    last_day = None
    for raw in session.read_text(errors="ignore").splitlines():
        try:
            e = json.loads(raw)
        except ValueError:
            continue
        if e.get("type") not in ("user", "assistant") or e.get("isSidechain"):
            continue
        msg = e.get("message") or {}
        ts = e.get("timestamp")
        when = ""
        if ts:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(IST)
            if dt.date() != last_day:
                last_day = dt.date()
                out += ["", f"## {dt:%A %d %B %Y}", ""]
            when = f"{dt:%H:%M}"
        content = msg.get("content")
        blocks = [{"type": "text", "text": content}] if isinstance(content, str) else (content or [])
        for b in blocks:
            t = b.get("type")
            if e["type"] == "user" and t == "text":
                text = strip_reminders(b.get("text", ""))
                if not text or text.startswith("Caveat:"):
                    continue
                text = re.sub(r"</?pasted_content[^>]*>", "", text)
                out += [f"### 🧑 User · {when}", "", text, ""]
            elif e["type"] == "user" and t == "tool_result":
                c = b.get("content")
                res = c if isinstance(c, str) else "\n".join(x.get("text", "") for x in (c or []) if isinstance(x, dict))
                res = strip_reminders(res)
                if res:
                    out += ["<details><summary>result</summary>", "", "```", clip(res), "```", "", "</details>", ""]
            elif e["type"] == "assistant" and t == "text" and b.get("text", "").strip():
                out += [f"### 🤖 Claude · {when}", "", b["text"].strip(), ""]
            elif e["type"] == "assistant" and t == "tool_use":
                out += [f"- {tool_line(b)}", ""]
    return redact("\n".join(out), secrets)


def main() -> int:
    session, dest = Path(sys.argv[1]), Path(sys.argv[2])
    secrets = known_secrets()
    text = render(session, secrets)
    leaks = [s[:6] + "…" for s in secrets if s in text]
    if leaks:
        print(f"refusing to write: {len(leaks)} known secret(s) still present", file=sys.stderr)
        return 1
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text, encoding="utf-8")
    print(f"wrote {dest} ({len(text) // 1024} KB, {text.count('### 🧑')} prompts, "
          f"{text.count('### 🤖')} replies; {len(secrets)} known secrets checked)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

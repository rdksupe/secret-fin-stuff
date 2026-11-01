"""App ⇄ Hermes conversation over the `finn_app` platform plugin.

The app talks to FINN like a Telegram user talks to a bot: messages go to the Hermes
gateway (sessions, burst merging, steer, /stop, crons are all Hermes'), replies and
streaming edits come back here, get stored, and fan out to whichever app is listening.
When nobody is listening (a cron fired, a reminder), the message becomes an FCM push.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from collections import defaultdict

import httpx
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from finn_api.auth import require_auth
from finn_api.config import settings
from finn_api.db import get_db
from finn_api.models import ChatMessage, User

log = logging.getLogger("finn.conversation")
router = APIRouter(prefix="/api")

# chat_id → live subscriber queues (one per open app stream). Single-process API.
_subs: dict[str, set[asyncio.Queue]] = defaultdict(set)


def _msg(m: ChatMessage) -> dict:
    return {"id": m.id, "chat_id": m.chat_id, "role": m.role, "kind": m.kind, "text": m.text,
            "payload": json.loads(m.payload_json or "{}"), "final": m.final, "proactive": m.proactive,
            "at": m.created_at.isoformat()}


def _publish(chat_id: str, event: dict) -> int:
    for q in list(_subs.get(chat_id, ())):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass
    return len(_subs.get(chat_id, ()))


def _valid_chat(chat_id: str) -> str:
    if not chat_id or len(chat_id) > 64 or not all(c.isalnum() or c in "-_" for c in chat_id):
        raise HTTPException(400, "bad chat id")
    return chat_id


async def _bridge(path: str, body: dict) -> dict:
    if not settings.finn_app_bridge_secret:
        raise HTTPException(503, "FINN chat bridge not configured")
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(f"{settings.finn_app_bridge_url}{path}", json=body,
                             headers={"X-Finn-Bridge": settings.finn_app_bridge_secret})
    except httpx.HTTPError as e:
        raise HTTPException(502, f"FINN agent unreachable: {e}") from e
    if r.status_code >= 400:
        raise HTTPException(502, f"FINN agent: {r.text[:200]}")
    return r.json()


# ── app side (JWT) ─────────────────────────────────────────────────────────


class Say(BaseModel):
    text: str
    context: str | None = None  # e.g. "about TCS" / the story the user opened
    reply_to: str | None = None  # id of the message being quoted


def _quote(db: Session, chat_id: str, mid: str | None) -> dict | None:
    q = db.get(ChatMessage, mid) if mid else None
    if not q or q.chat_id != chat_id:
        return None
    return {"id": q.id, "role": q.role, "text": (q.text or "")[:500]}


@router.post("/conversations/{chat_id}/messages", dependencies=[Depends(require_auth)])
async def say(chat_id: str, body: Say, db: Session = Depends(get_db)):
    _valid_chat(chat_id)
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "empty message")
    quote = _quote(db, chat_id, body.reply_to)
    payload = {"reply_to": quote["id"], "reply_text": quote["text"][:160], "reply_role": quote["role"]} if quote else {}
    m = ChatMessage(chat_id=chat_id, role="user", text=text, payload_json=json.dumps(payload))
    db.add(m)
    db.commit()
    _publish(chat_id, {"type": "message", "message": _msg(m)})
    # Context rides along as a bracketed preface the agent can see; the user sees their own words.
    agent_text = f"[{body.context}]\n{text}" if body.context else text
    # Answer the app at once and hand off to Hermes in the background: the app must not wait on the
    # agent's event loop (seconds when the worker is busy) to show that the message arrived.
    _publish(chat_id, {"type": "typing"})
    task = asyncio.create_task(_handoff(chat_id, m.id, agent_text, quote))
    _handoffs.add(task)
    task.add_done_callback(_handoffs.discard)
    return _msg(m)


_handoffs: set[asyncio.Task] = set()


async def _handoff(chat_id: str, message_id: str, text: str, quote: dict | None) -> None:
    try:
        await _bridge("/inbound", {"chat_id": chat_id, "user_id": chat_id, "text": text, "message_id": message_id,
                                   "reply_to": quote})
    except Exception as e:  # tell the chat rather than fail silently
        log.warning("hand-off to Hermes failed for %s: %s", chat_id, e)
        from finn_api.db import SessionLocal

        with SessionLocal() as db:
            err = ChatMessage(chat_id=chat_id, role="finn", kind="message", final=True,
                              text="FINN couldn't pick that up just now. Send it again in a moment.")
            db.add(err)
            db.commit()
            _publish(chat_id, {"type": "message", "message": _msg(err)})


class React(BaseModel):
    emoji: str | None = None  # None clears it


@router.post("/conversations/{chat_id}/messages/{message_id}/reaction", dependencies=[Depends(require_auth)])
def react(chat_id: str, message_id: str, body: React, db: Session = Depends(get_db)):
    """The investor's reaction on one of FINN's messages (kept as feedback; not sent to the agent)."""
    _valid_chat(chat_id)
    m = db.get(ChatMessage, message_id)
    if not m or m.chat_id != chat_id:
        raise HTTPException(404)
    if body.emoji and len(body.emoji) > 8:
        raise HTTPException(400, "one emoji")
    p = json.loads(m.payload_json or "{}")
    p["reaction"] = body.emoji
    m.payload_json = json.dumps(p)
    db.commit()
    _publish(chat_id, {"type": "update", "message": _msg(m)})
    return _msg(m)


# ── voice: speech in (smallest.ai STT) and speech out (TTS) ─────────────────

_VOICE = settings.finn_kb_dir.parent / "hermes" / "scripts" / "voice"


def _voice_env() -> dict:
    import os

    if not settings.smallest_api_key:
        raise HTTPException(503, "voice not configured")
    return os.environ | {"SMALLEST_API_KEY": settings.smallest_api_key}


async def _run(*args: str, timeout: int = 180) -> None:
    proc = await asyncio.create_subprocess_exec(*args, env=_voice_env(), stdout=asyncio.subprocess.PIPE,
                                                stderr=asyncio.subprocess.PIPE)
    try:
        _, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except TimeoutError as e:
        proc.kill()
        raise HTTPException(504, "voice service timed out") from e
    if proc.returncode != 0:
        raise HTTPException(502, f"voice service failed: {err.decode(errors='ignore')[-200:]}")


@router.post("/conversations/{chat_id}/voice", dependencies=[Depends(require_auth)])
async def say_voice(chat_id: str, audio: UploadFile = File(...), context: str | None = None,
                    db: Session = Depends(get_db)):
    """A voice note: transcribe it, show the transcript as the user's message, send it on to FINN."""
    import uuid

    _valid_chat(chat_id)
    d = settings.finn_audio_dir
    d.mkdir(parents=True, exist_ok=True)
    ext = (audio.filename or "note.m4a").rsplit(".", 1)[-1][:5] or "m4a"
    src = d / f"in-{uuid.uuid4().hex}.{ext}"
    src.write_bytes(await audio.read())
    out = src.with_suffix(".txt")
    await _run("python3", str(_VOICE / "smallest_stt.py"), "--audio", str(src), "--out", str(out))
    text = out.read_text(encoding="utf-8").strip() if out.exists() else ""
    if not text:
        raise HTTPException(422, "couldn't make out any words in that recording")
    msg = await say(chat_id, Say(text=text, context=context), db)
    m = db.get(ChatMessage, msg["id"])
    m.payload_json = json.dumps({"voice": True})
    db.commit()
    return _msg(m)


def _speakable(md: str) -> str:
    """Markdown → something a voice can read: drop tables, citations, formatting."""
    lines = [ln for ln in md.splitlines() if not ln.strip().startswith("|")]
    t = "\n".join(lines)
    t = re.sub(r"\([a-z0-9_-]+/[^)]+\)", "", t)  # (results/2026-09-30.md)
    t = re.sub(r"[*_`#>]", "", t).replace("▉", "")
    t = re.sub(r"\n{2,}", "\n", t).strip()
    # Finance shorthand → words a voice reads correctly.
    t = re.sub(r"₹\s?([\d,.]+)\s?(Cr|cr|crore)\b", r"\1 crore rupees", t)
    t = re.sub(r"₹\s?([\d,.]+)\s?(L|lakh)\b", r"\1 lakh rupees", t)
    t = re.sub(r"₹\s?([\d,.]+)", r"\1 rupees", t)
    for a, b in (("QoQ", "quarter on quarter"), ("YoY", "year on year"), ("bps", "basis points"),
                 ("CC", "constant currency"), ("FY", "F Y "), ("PAT", "profit after tax"),
                 ("PBT", "profit before tax"), ("EBITDA", "E B I T D A"), ("TCV", "total contract value")):
        t = re.sub(rf"\b{a}\b", b, t)
    t = re.sub(r"\(?NSE XBRL[^)]*\)?", "", t)
    return t[:1500]


@router.post("/conversations/{chat_id}/messages/{message_id}/speech", dependencies=[Depends(require_auth)])
async def speech(chat_id: str, message_id: str, db: Session = Depends(get_db)):
    _valid_chat(chat_id)
    m = db.get(ChatMessage, message_id)
    if not m or m.chat_id != chat_id or m.role != "finn":
        raise HTTPException(404)
    d = settings.finn_audio_dir
    d.mkdir(parents=True, exist_ok=True)
    mp3 = d / f"tts-{m.id}.mp3"
    if not mp3.exists():
        txt = d / f"tts-{m.id}.txt"
        txt.write_text(_speakable(m.text), encoding="utf-8")
        await _run("python3", str(_VOICE / "smallest_tts.py"), "--text-file", str(txt), "--out", str(mp3))
    return {"url": f"/api/audio/{mp3.name}"}


@router.get("/audio/{name}")
def audio_file(name: str, token: str | None = Query(default=None), request: Request = None):
    """Audio for the app's player. Accepts the bearer token as ?token= because native audio
    players can't always attach headers."""
    from finn_api.auth import require_auth as _check

    auth = request.headers.get("authorization") if request else None
    _check(authorization=auth or (f"Bearer {token}" if token else None), x_api_key=None)
    if not re.fullmatch(r"tts-[0-9a-f-]{36}\.mp3", name):
        raise HTTPException(404)
    p = settings.finn_audio_dir / name
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p, media_type="audio/mpeg")


@router.get("/conversations", dependencies=[Depends(require_auth)])
def conversations(ids: str = "", db: Session = Depends(get_db)):
    """Summaries of this install's sessions (it keeps the list of ids), plus FINN's home channel,
    where scheduled jobs land. Each is its own Hermes session and can be running at once."""
    from datetime import UTC, datetime, timedelta

    wanted = [i for i in ids.split(",") if i][:50]
    out = []
    for cid in [*wanted, "home"]:
        try:
            _valid_chat(cid)
        except HTTPException:
            continue
        rows = db.scalars(select(ChatMessage).where(ChatMessage.chat_id == cid)
                          .order_by(ChatMessage.created_at.desc()).limit(40)).all()
        if not rows and cid == "home":
            continue
        first = next((r.text for r in reversed(rows) if r.role == "user" and not r.text.startswith("/")), "")
        last = next((r for r in rows if r.kind in ("message", "approval", "clarify", "confirm")
                     and not (r.role == "user" and r.text.startswith("/"))), None)
        now = datetime.now(tz=UTC).replace(tzinfo=None)
        head = rows[0] if rows else None
        working = bool(head) and (
            (head.role == "finn" and head.kind == "message" and not head.final
             and now - head.created_at < timedelta(minutes=5))
            or (head.kind == "tool" and now - head.created_at < timedelta(seconds=90))
            or (head.role == "user" and not head.text.startswith("/") and now - head.created_at < timedelta(seconds=90))
        )
        out.append({
            "id": cid,
            "title": "Scheduled from FINN" if cid == "home" else (first[:80] or "New chat"),
            "last": (last.text or "").strip()[:140] if last else "",
            "last_role": last.role if last else None,
            "at": (head.created_at.isoformat() if head else None),
            "working": working,
            "count": len(rows),
        })
    return out


@router.get("/conversations/{chat_id}/messages", dependencies=[Depends(require_auth)])
def history(chat_id: str, limit: int = 60, db: Session = Depends(get_db)):
    _valid_chat(chat_id)
    rows = db.scalars(select(ChatMessage).where(ChatMessage.chat_id == chat_id)
                      .order_by(ChatMessage.created_at.desc()).limit(min(limit, 200))).all()
    return [_msg(m) for m in reversed(rows)]


@router.get("/conversations/{chat_id}/stream", dependencies=[Depends(require_auth)])
async def stream(chat_id: str, request: Request):
    _valid_chat(chat_id)
    q: asyncio.Queue = asyncio.Queue(maxsize=500)
    _subs[chat_id].add(q)

    async def events():
        try:
            yield "event: ready\ndata: {}\n\n"
            while not await request.is_disconnected():
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                except TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            _subs[chat_id].discard(q)

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class Tap(BaseModel):
    message_id: str
    choice: str


@router.post("/conversations/{chat_id}/actions", dependencies=[Depends(require_auth)])
async def tap(chat_id: str, body: Tap, db: Session = Depends(get_db)):
    """A button in an approval / clarify prompt."""
    _valid_chat(chat_id)
    m = db.get(ChatMessage, body.message_id)
    if not m or m.chat_id != chat_id or m.kind not in ("approval", "clarify", "confirm"):
        raise HTTPException(404, "no such prompt")
    p = json.loads(m.payload_json or "{}")
    if p.get("answered"):
        return _msg(m)
    res = await _bridge("/action", {"kind": m.kind, "chat_id": chat_id, "choice": body.choice,
                                    "id": p.get("id"), "session_key": p.get("session_key")})
    p["answered"] = body.choice
    p["resolved"] = bool(res.get("ok"))
    m.payload_json = json.dumps(p)
    db.commit()
    _publish(chat_id, {"type": "update", "message": _msg(m)})
    return _msg(m)


# ── adapter side (server key only) ─────────────────────────────────────────


class HermesEvent(BaseModel):
    chat_id: str
    type: str  # message | edit | typing | reaction | approval | clarify | confirm
    text: str | None = None
    message_id: str | None = None
    finalize: bool = False
    proactive: bool = False
    command: str | None = None
    choices: list[str] | None = None
    id: str | None = None
    session_key: str | None = None
    reply_to: str | None = None
    kind: str | None = None  # "tool" for the gateway's tool-progress bubble


@router.post("/internal/hermes/events")
def hermes_event(ev: HermesEvent, claims: dict = Depends(require_auth), db: Session = Depends(get_db)):
    if claims.get("sub") != "server":
        raise HTTPException(403, "server key required")
    chat_id = _valid_chat(ev.chat_id)
    if ev.type == "typing":
        _publish(chat_id, {"type": "typing"})
        return {"ok": True}
    if ev.type == "reaction" and ev.message_id:
        # FINN's processing reaction on the investor's message (👀 → 👍 / 👎).
        m = db.get(ChatMessage, ev.message_id)
        if not m or m.chat_id != chat_id:
            return {"ok": False}
        p = json.loads(m.payload_json or "{}")
        p["finn_reaction"] = ev.text or None
        m.payload_json = json.dumps(p)
        db.commit()
        _publish(chat_id, {"type": "update", "message": _msg(m)})
        return {"ok": True, "message_id": m.id}
    if ev.type == "edit" and ev.message_id:
        m = db.get(ChatMessage, ev.message_id)
        if m:
            was_final = m.final
            m.text = ev.text or m.text
            m.final = True if m.kind == "tool" else ev.finalize
            db.commit()
            listeners = _publish(chat_id, {"type": "update", "message": _msg(m)})
            if m.kind == "message" and m.final and not was_final and listeners == 0:
                # A streamed answer finished while the investor was elsewhere (another chat, app closed).
                _push_to_phone(db, m)
            return {"ok": True, "message_id": m.id}
    kind = ev.type if ev.type in ("approval", "clarify", "confirm") else ("tool" if ev.kind == "tool" else "message")
    payload = {k: v for k, v in {"command": ev.command, "choices": ev.choices, "id": ev.id,
                                 "session_key": ev.session_key}.items() if v}
    quote = _quote(db, chat_id, ev.reply_to)
    if quote:
        payload |= {"reply_to": quote["id"], "reply_text": quote["text"][:160], "reply_role": quote["role"]}
    final = kind != "message" or ev.finalize
    m = ChatMessage(chat_id=chat_id, role="finn", kind=kind, text=ev.text or "", payload_json=json.dumps(payload),
                    final=final, proactive=ev.proactive)
    db.add(m)
    db.commit()
    listeners = _publish(chat_id, {"type": "message", "message": _msg(m)})
    if listeners == 0 and kind != "tool" and final:
        # Nobody has the app open: a cron result, reminder or late reply — push it.
        m.proactive = True
        db.commit()
        _push_to_phone(db, m)
    return {"ok": True, "message_id": m.id}


# ── media FINN sends (charts it rendered, files it made) ───────────────────

_MEDIA_TYPES = {".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image", ".gif": "image",
                ".pdf": "document", ".csv": "document", ".xlsx": "document", ".mp3": "audio", ".ogg": "audio",
                ".m4a": "audio", ".mp4": "video"}


def _media_dir():
    d = settings.finn_audio_dir.parent / "media"
    d.mkdir(parents=True, exist_ok=True)
    return d


@router.post("/internal/hermes/media")
async def hermes_media(chat_id: str = Form(...), caption: str = Form(""), file: UploadFile = File(...),
                       claims: dict = Depends(require_auth), db: Session = Depends(get_db)):
    """The finn_app adapter's native file delivery: store the file, post it as a chat attachment."""
    import uuid
    from pathlib import Path

    if claims.get("sub") != "server":
        raise HTTPException(403, "server key required")
    chat_id = _valid_chat(chat_id)
    name = Path(file.filename or "file").name
    ext = Path(name).suffix.lower()
    kind = _MEDIA_TYPES.get(ext)
    if not kind:
        raise HTTPException(415, f"unsupported file type {ext}")
    stored = f"{uuid.uuid4().hex}{ext}"
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(413, "file too large")
    (_media_dir() / stored).write_bytes(data)
    payload = {"attachments": [{"type": kind, "url": f"/api/media/{stored}", "name": name, "bytes": len(data)}]}
    m = ChatMessage(chat_id=chat_id, role="finn", kind="message", text=caption or "", payload_json=json.dumps(payload),
                    final=True)
    db.add(m)
    db.commit()
    if _publish(chat_id, {"type": "message", "message": _msg(m)}) == 0:
        m.proactive = True
        db.commit()
        _push_to_phone(db, m)
    return {"ok": True, "message_id": m.id}


@router.get("/media/{name}")
def media_file(name: str, token: str | None = Query(default=None), request: Request = None):
    """Attachments for the app. Accepts the bearer token as ?token= because native image views
    can't always attach headers."""
    from finn_api.auth import require_auth as _check

    auth = request.headers.get("authorization") if request else None
    _check(authorization=auth or (f"Bearer {token}" if token else None), x_api_key=None)
    if not re.fullmatch(r"[0-9a-f]{32}\.[a-z0-9]{2,5}", name):
        raise HTTPException(404)
    p = _media_dir() / name
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p)


def _push_to_phone(db: Session, m: ChatMessage) -> None:
    from finn_api import fcm

    if not fcm.available():
        return
    user = db.scalar(select(User).order_by(User.created_at))
    tokens = [t[4:] for t in json.loads(user.push_tokens_json or "[]") if t.startswith("fcm:")] if user else []
    first = (m.text or "").strip().splitlines()[0] if m.text else "FINN"
    for t in tokens:
        fcm.send(t, "FINN", first[:200], {"chat_id": m.chat_id, "message_id": m.id, "kind": "chat"})

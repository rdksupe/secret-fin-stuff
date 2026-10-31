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
from collections import defaultdict

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
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


@router.post("/conversations/{chat_id}/messages", dependencies=[Depends(require_auth)])
async def say(chat_id: str, body: Say, db: Session = Depends(get_db)):
    _valid_chat(chat_id)
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "empty message")
    m = ChatMessage(chat_id=chat_id, role="user", text=text)
    db.add(m)
    db.commit()
    _publish(chat_id, {"type": "message", "message": _msg(m)})
    # Context rides along as a bracketed preface the agent can see; the user sees their own words.
    agent_text = f"[{body.context}]\n{text}" if body.context else text
    await _bridge("/inbound", {"chat_id": chat_id, "user_id": chat_id, "text": agent_text, "message_id": m.id})
    return _msg(m)


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
    if not m or m.chat_id != chat_id or m.kind not in ("approval", "clarify"):
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
    type: str  # message | edit | typing | approval | clarify
    text: str | None = None
    message_id: str | None = None
    finalize: bool = False
    proactive: bool = False
    command: str | None = None
    choices: list[str] | None = None
    id: str | None = None
    session_key: str | None = None
    reply_to: str | None = None


@router.post("/internal/hermes/events")
def hermes_event(ev: HermesEvent, claims: dict = Depends(require_auth), db: Session = Depends(get_db)):
    if claims.get("sub") != "server":
        raise HTTPException(403, "server key required")
    chat_id = _valid_chat(ev.chat_id)
    if ev.type == "typing":
        _publish(chat_id, {"type": "typing"})
        return {"ok": True}
    if ev.type == "edit" and ev.message_id:
        m = db.get(ChatMessage, ev.message_id)
        if m:
            m.text, m.final = ev.text or m.text, ev.finalize
            db.commit()
            _publish(chat_id, {"type": "update", "message": _msg(m)})
            return {"ok": True, "message_id": m.id}
    kind = ev.type if ev.type in ("approval", "clarify") else "message"
    payload = {k: v for k, v in {"command": ev.command, "choices": ev.choices, "id": ev.id,
                                 "session_key": ev.session_key}.items() if v}
    m = ChatMessage(chat_id=chat_id, role="finn", kind=kind, text=ev.text or "", payload_json=json.dumps(payload),
                    final=kind != "message", proactive=ev.proactive)
    db.add(m)
    db.commit()
    listeners = _publish(chat_id, {"type": "message", "message": _msg(m)})
    if listeners == 0:
        # Nobody has the app open: a cron result, reminder or late reply — push it.
        m.proactive = True
        db.commit()
        _push_to_phone(db, m)
    return {"ok": True, "message_id": m.id}


def _push_to_phone(db: Session, m: ChatMessage) -> None:
    from finn_api import fcm

    if not fcm.available():
        return
    user = db.scalar(select(User).order_by(User.created_at))
    tokens = [t[4:] for t in json.loads(user.push_tokens_json or "[]") if t.startswith("fcm:")] if user else []
    first = (m.text or "").strip().splitlines()[0] if m.text else "FINN"
    for t in tokens:
        fcm.send(t, "FINN", first[:200], {"chat_id": m.chat_id, "message_id": m.id, "kind": "chat"})

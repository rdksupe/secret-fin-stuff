"""FINN app platform adapter for Hermes.

Inbound  (FINN API → here): POST /inbound {chat_id, user_id, text, message_id}
                            POST /action  {chat_id, kind, id, choice, session_key}
Outbound (here → FINN API): POST {FINN_APP_API_URL}/api/internal/hermes/events
                            {chat_id, type: message|edit|typing|approval|clarify, ...}

Everything conversational (sessions, burst merging, steer/interrupt, slash
commands, cron delivery to origin, approvals) is the gateway's — this adapter
is transport only.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import UTC, datetime
from typing import Any, Dict, List, Optional

import httpx
from aiohttp import web

from gateway.config import Platform, PlatformConfig
from gateway.platforms.base import BasePlatformAdapter, MessageEvent, MessageType, SendResult

logger = logging.getLogger(__name__)
PLATFORM = "finn_app"
MAX_MESSAGE_LENGTH = 16000


def _api_url(extra: dict | None = None) -> str:
    return ((extra or {}).get("api_url") or os.getenv("FINN_APP_API_URL") or "http://127.0.0.1:8000").rstrip("/")


def _server_key() -> str:
    # The adapter authenticates to the FINN API as a server-side tool.
    return os.getenv("FINN_API_KEY", "")


async def _post_event(client: httpx.AsyncClient, base: str, event: dict) -> dict:
    r = await client.post(f"{base}/api/internal/hermes/events", json=event,
                          headers={"X-API-Key": _server_key()}, timeout=15)
    r.raise_for_status()
    return r.json()


def check_requirements() -> bool:
    return bool(os.getenv("FINN_APP_BRIDGE_SECRET"))


def validate_config(config) -> bool:
    return check_requirements()


def is_connected(config) -> bool:
    return check_requirements()


class FinnAppAdapter(BasePlatformAdapter):
    MAX_MESSAGE_LENGTH = MAX_MESSAGE_LENGTH

    def __init__(self, config: PlatformConfig):
        super().__init__(config=config, platform=Platform(PLATFORM))
        extra = config.extra or {}
        self._api = _api_url(extra)
        self._secret = os.getenv("FINN_APP_BRIDGE_SECRET", "")
        host, _, port = (extra.get("listen") or os.getenv("FINN_APP_LISTEN") or "127.0.0.1:8650").rpartition(":")
        self._host, self._port = host or "127.0.0.1", int(port or 8650)
        self._client: Optional[httpx.AsyncClient] = None
        self._runner: Optional[web.AppRunner] = None

    # ── lifecycle ──────────────────────────────────────────────────────────

    async def connect(self) -> bool:
        if not self._secret:
            logger.warning("[%s] FINN_APP_BRIDGE_SECRET not set", self.name)
            return False
        self._client = httpx.AsyncClient()
        app = web.Application()
        app.router.add_post("/inbound", self._inbound)
        app.router.add_post("/action", self._action)
        app.router.add_get("/health", lambda _r: web.json_response({"ok": True}))
        self._runner = web.AppRunner(app)
        await self._runner.setup()
        await web.TCPSite(self._runner, self._host, self._port).start()
        self._mark_connected()
        logger.info("[%s] bridge listening on %s:%s → %s", self.name, self._host, self._port, self._api)
        return True

    async def disconnect(self) -> None:
        if self._runner:
            await self._runner.cleanup()
            self._runner = None
        if self._client:
            await self._client.aclose()
            self._client = None

    def _authorized(self, request: web.Request) -> bool:
        return bool(self._secret) and request.headers.get("X-Finn-Bridge") == self._secret

    # ── inbound ────────────────────────────────────────────────────────────

    async def _inbound(self, request: web.Request) -> web.Response:
        if not self._authorized(request):
            return web.json_response({"error": "unauthorized"}, status=401)
        body = await request.json()
        chat_id = str(body.get("chat_id") or "").strip()
        text = str(body.get("text") or "").strip()
        if not chat_id or not text:
            return web.json_response({"error": "chat_id and text required"}, status=400)
        user_id = str(body.get("user_id") or chat_id)
        source = self.build_source(chat_id=chat_id, chat_name="FINN", chat_type="dm",
                                   user_id=user_id, user_name=body.get("user_name") or "Investor")
        event = MessageEvent(
            text=text,
            message_type=MessageType.TEXT,
            source=source,
            message_id=str(body.get("message_id") or uuid.uuid4().hex),
            raw_message=body,
            timestamp=datetime.now(tz=UTC),
        )
        # Don't block the HTTP reply on the agent run.
        asyncio.create_task(self.handle_message(event))
        return web.json_response({"ok": True})

    async def _action(self, request: web.Request) -> web.Response:
        """Button taps: approvals and clarify answers resolve the waiting agent thread."""
        if not self._authorized(request):
            return web.json_response({"error": "unauthorized"}, status=401)
        body = await request.json()
        kind = body.get("kind")
        try:
            if kind == "approval":
                from tools.approval import resolve_gateway_approval

                n = resolve_gateway_approval(str(body["session_key"]), str(body["choice"]))
                return web.json_response({"ok": n > 0, "resolved": n})
            if kind == "clarify":
                from tools.clarify_gateway import resolve_gateway_clarify

                return web.json_response({"ok": resolve_gateway_clarify(str(body["id"]), str(body["choice"]))})
        except Exception as e:  # pragma: no cover — surfaced to the API
            logger.warning("[%s] action failed: %s", self.name, e)
            return web.json_response({"ok": False, "error": str(e)}, status=500)
        return web.json_response({"error": f"unknown action {kind}"}, status=400)

    # ── outbound ───────────────────────────────────────────────────────────

    async def _emit(self, event: dict) -> dict:
        if not self._client:
            raise RuntimeError("adapter not connected")
        return await _post_event(self._client, self._api, event)

    async def send(self, chat_id: str, content: str, reply_to: Optional[str] = None,
                   metadata: Optional[Dict[str, Any]] = None) -> SendResult:
        try:
            res = await self._emit({"chat_id": chat_id, "type": "message", "text": content[:MAX_MESSAGE_LENGTH],
                                    "reply_to": reply_to})
            return SendResult(success=True, message_id=res.get("message_id"))
        except Exception as e:
            logger.warning("[%s] send failed: %s", self.name, e)
            return SendResult(success=False, error=str(e))

    async def edit_message(self, chat_id: str, message_id: str, content: str, *, finalize: bool = False) -> SendResult:
        """Streaming: the gateway sends once, then edits as tokens arrive."""
        try:
            await self._emit({"chat_id": chat_id, "type": "edit", "message_id": message_id,
                              "text": content[:MAX_MESSAGE_LENGTH], "finalize": finalize})
            return SendResult(success=True, message_id=message_id)
        except Exception as e:
            return SendResult(success=False, error=str(e))

    async def send_typing(self, chat_id: str, metadata=None) -> None:
        try:
            await self._emit({"chat_id": chat_id, "type": "typing"})
        except Exception:
            pass

    async def send_exec_approval(self, chat_id: str, command: str, session_key: str,
                                 description: str = "dangerous command",
                                 metadata: Optional[Dict[str, Any]] = None) -> SendResult:
        try:
            res = await self._emit({"chat_id": chat_id, "type": "approval", "text": description,
                                    "command": command, "session_key": session_key,
                                    "choices": ["approve", "deny"]})
            return SendResult(success=True, message_id=res.get("message_id"))
        except Exception as e:
            return SendResult(success=False, error=str(e))

    async def send_clarify(self, chat_id: str, question: str, choices: Optional[list], clarify_id: str,
                           session_key: str, metadata: Optional[Dict[str, Any]] = None) -> SendResult:
        try:
            res = await self._emit({"chat_id": chat_id, "type": "clarify", "text": question,
                                    "choices": [str(c) for c in (choices or [])], "id": clarify_id,
                                    "session_key": session_key})
            return SendResult(success=True, message_id=res.get("message_id"))
        except Exception as e:
            return SendResult(success=False, error=str(e))

    async def send_image(self, chat_id: str, image_url: str, caption: Optional[str] = None, **_kw) -> SendResult:
        return await self.send(chat_id, f"{caption + chr(10) if caption else ''}![image]({image_url})")

    async def get_chat_info(self, chat_id: str) -> Dict[str, Any]:
        return {"name": "FINN", "type": "dm", "chat_id": chat_id}


# ── registration ───────────────────────────────────────────────────────────


def _env_enablement() -> dict | None:
    if not os.getenv("FINN_APP_BRIDGE_SECRET"):
        return None
    home = os.getenv("FINN_APP_HOME_CHANNEL", "home")
    return {
        "api_url": _api_url(),
        "listen": os.getenv("FINN_APP_LISTEN", "127.0.0.1:8650"),
        "home_channel": {"chat_id": home, "name": "FINN app"},
    }


async def _standalone_send(pconfig, chat_id: str, message: str, *, thread_id: Optional[str] = None,
                           media_files: Optional[List[str]] = None, force_document: bool = False) -> Dict[str, Any]:
    """Cron / send_message delivery when the gateway isn't in this process."""
    try:
        async with httpx.AsyncClient() as c:
            res = await _post_event(c, _api_url(getattr(pconfig, "extra", None)),
                                    {"chat_id": chat_id or os.getenv("FINN_APP_HOME_CHANNEL", "home"),
                                     "type": "message", "text": message[:MAX_MESSAGE_LENGTH], "proactive": True})
        return {"success": True, "platform": PLATFORM, "chat_id": chat_id, "message_id": res.get("message_id")}
    except Exception as e:
        return {"error": f"finn_app standalone send failed: {e}"}


def register(ctx) -> None:
    ctx.register_platform(
        name=PLATFORM,
        label="FINN app",
        adapter_factory=lambda cfg: FinnAppAdapter(cfg),
        check_fn=check_requirements,
        validate_config=validate_config,
        is_connected=is_connected,
        required_env=["FINN_APP_BRIDGE_SECRET"],
        install_hint="aiohttp + httpx (Hermes dependencies)",
        env_enablement_fn=_env_enablement,
        cron_deliver_env_var="FINN_APP_HOME_CHANNEL",
        standalone_sender_fn=_standalone_send,
        allowed_users_env="FINN_APP_ALLOWED_USERS",
        allow_all_env="FINN_APP_ALLOW_ALL_USERS",
        max_message_length=MAX_MESSAGE_LENGTH,
        emoji="📈",
        pii_safe=True,
        platform_hint=(
            "You are talking to an investor in the FINN mobile app. Markdown renders (headings, bold, "
            "bullet lists, tables). Keep answers tight for a phone screen; lead with the answer. "
            "Scheduled jobs you create with the cronjob tool and deliver=origin come back to this app "
            "as a notification."
        ),
    )

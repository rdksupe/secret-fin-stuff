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
import re
import uuid
from datetime import UTC, datetime
from typing import Any, Dict, List, Optional

import httpx
from aiohttp import web

from gateway.config import Platform, PlatformConfig
from gateway.platforms.base import BasePlatformAdapter, MessageEvent, MessageType, ProcessingOutcome, SendResult

logger = logging.getLogger(__name__)
PLATFORM = "finn_app"
MAX_MESSAGE_LENGTH = 16000

# The gateway's tool-progress bubble ("🔍 web_search: \"…\"", "📈 finn_results...", "💻 terminal\n```…")
# arrives through the same send/edit calls as the answer, with no metadata. Its first line is
# always "<emoji> <tool_name>" followed by `: "`, `...`, `(` or the end of the line.
_PROGRESS = re.compile(r'^\S{1,3} [a-z][a-z0-9_]*(?:: "|\.\.\.|\(|\s*$)')


def _is_progress(content: str, metadata: Optional[Dict[str, Any]]) -> bool:
    if metadata:  # streamed answers always carry expect_edits / notify
        return False
    first = (content or "").lstrip().split("\n", 1)[0]
    return bool(_PROGRESS.match(first))


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
        self._loop = asyncio.get_running_loop()
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
        reply = body.get("reply_to") or {}
        event = MessageEvent(
            text=text,
            message_type=MessageType.TEXT,
            source=source,
            message_id=str(body.get("message_id") or uuid.uuid4().hex),
            raw_message=body,
            timestamp=datetime.now(tz=UTC),
            # Same reply semantics as Telegram: the gateway injects the quoted text as context.
            reply_to_message_id=reply.get("id"),
            reply_to_text=reply.get("text"),
            reply_to_is_own_message=reply.get("role") == "finn",
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
            if kind == "confirm":
                # Slash-command confirm (/new, /reset…): the handler's reply goes back as a message.
                from tools import slash_confirm

                result = await slash_confirm.resolve(str(body["session_key"]), str(body["id"]), str(body["choice"]))
                if result:
                    await self.send(str(body["chat_id"]), result, metadata={"notify": True})
                return web.json_response({"ok": result is not None})
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
        if asyncio.get_running_loop() is not getattr(self, "_loop", None):
            # Cron delivery calls us from the scheduler's own event loop; the shared client's pool is
            # bound to the gateway loop, so use a short-lived client here.
            async with httpx.AsyncClient() as c:
                return await _post_event(c, self._api, event)
        return await _post_event(self._client, self._api, event)

    async def send(self, chat_id: str, content: str, reply_to: Optional[str] = None,
                   metadata: Optional[Dict[str, Any]] = None) -> SendResult:
        try:
            res = await self._emit({"chat_id": chat_id, "type": "message", "text": content[:MAX_MESSAGE_LENGTH],
                                    "reply_to": reply_to,
                                    "kind": "tool" if _is_progress(content, metadata) else "message",
                                    # A scheduled watch's result (Hermes cron passes its job id): pushes open that watch.
                                    "job_id": (metadata or {}).get("job_id"),
                                    # Streamed previews are edited until finalize; anything else is complete.
                                    "finalize": not (metadata or {}).get("expect_edits")})
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

    # Processing lifecycle, as on Telegram: 👀 on the user's message while FINN works, then 👍 / 👎.
    async def _react(self, event: MessageEvent, emoji: Optional[str]) -> None:
        chat_id = getattr(event.source, "chat_id", None)
        if chat_id and event.message_id:
            try:
                await self._emit({"chat_id": chat_id, "type": "reaction", "message_id": event.message_id,
                                  "text": emoji})
            except Exception:
                pass

    async def on_processing_start(self, event: MessageEvent) -> None:
        await self._react(event, "\U0001f440")

    async def on_processing_complete(self, event: MessageEvent, outcome: ProcessingOutcome) -> None:
        if outcome == ProcessingOutcome.CANCELLED:
            await self._react(event, None)
        else:
            await self._react(event, "\U0001f44d" if outcome == ProcessingOutcome.SUCCESS else "\U0001f44e")

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

    async def send_slash_confirm(self, chat_id: str, title: str, message: str, session_key: str,
                                 confirm_id: str, metadata: Optional[Dict[str, Any]] = None) -> SendResult:
        """Approve once / Always approve / Cancel as buttons, like Telegram."""
        try:
            res = await self._emit({"chat_id": chat_id, "type": "confirm", "text": title or message,
                                    "choices": ["once", "always", "cancel"], "id": confirm_id,
                                    "session_key": session_key})
            return SendResult(success=True, message_id=res.get("message_id"))
        except Exception as e:
            return SendResult(success=False, error=str(e))

    # Native media: the gateway extracts MEDIA:<path> tags (and image tool output) and calls these.
    # Files go to the FINN API as chat attachments the app renders inline.
    async def _upload(self, chat_id: str, path: str, caption: Optional[str]) -> SendResult:
        if not self._client:
            return SendResult(success=False, error="adapter not connected")
        try:
            p = os.path.expanduser(path)
            with open(p, "rb") as f:
                r = await self._client.post(
                    f"{self._api}/api/internal/hermes/media",
                    data={"chat_id": chat_id, "caption": (caption or "")[:2000]},
                    files={"file": (os.path.basename(p), f.read())},
                    headers={"X-API-Key": _server_key()}, timeout=60)
            r.raise_for_status()
            return SendResult(success=True, message_id=r.json().get("message_id"))
        except Exception as e:
            logger.warning("[%s] media upload failed for %s: %s", self.name, path, e)
            return SendResult(success=False, error=str(e))

    async def send_image_file(self, chat_id: str, image_path: str, caption: Optional[str] = None,
                              reply_to: Optional[str] = None, metadata: Optional[Dict[str, Any]] = None, **_kw) -> SendResult:
        return await self._upload(chat_id, image_path, caption)

    async def send_document(self, chat_id: str, file_path: str, caption: Optional[str] = None,
                            file_name: Optional[str] = None, reply_to: Optional[str] = None,
                            metadata: Optional[Dict[str, Any]] = None, **_kw) -> SendResult:
        return await self._upload(chat_id, file_path, caption)

    async def send_video(self, chat_id: str, video_path: str, caption: Optional[str] = None, **_kw) -> SendResult:
        return await self._upload(chat_id, video_path, caption)

    async def send_voice(self, chat_id: str, audio_path: str, caption: Optional[str] = None, **_kw) -> SendResult:
        return await self._upload(chat_id, audio_path, caption)

    async def send_image(self, chat_id: str, image_url: str, caption: Optional[str] = None, **_kw) -> SendResult:
        if image_url.startswith(("/", "~", "file://")):
            return await self._upload(chat_id, image_url.removeprefix("file://"), caption)
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
                                     "type": "message", "text": message[:MAX_MESSAGE_LENGTH], "proactive": True,
                                     "finalize": True})
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

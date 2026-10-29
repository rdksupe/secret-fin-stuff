"""Firebase Cloud Messaging (HTTP v1) sender — no Google SDK.

The server holds a service-account key (FINN_FCM_CREDENTIALS, FCM role only), signs a
short-lived OAuth assertion with it, and posts each message to
  https://fcm.googleapis.com/v1/projects/{project}/messages:send
Tokens come from the native app (`getDevicePushTokenAsync`) via /api/push-token.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import httpx
import jwt

from finn_api.config import settings

log = logging.getLogger("finn.fcm")
SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
_token: dict = {"value": None, "exp": 0.0}


def available() -> bool:
    p = settings.finn_fcm_credentials
    return bool(p) and Path(p).is_file()


def _creds() -> dict:
    return json.loads(Path(settings.finn_fcm_credentials).read_text())


def _access_token(client: httpx.Client) -> str:
    if _token["value"] and time.time() < _token["exp"] - 60:
        return _token["value"]
    c = _creds()
    now = int(time.time())
    assertion = jwt.encode(
        {"iss": c["client_email"], "scope": SCOPE, "aud": c["token_uri"], "iat": now, "exp": now + 3600},
        c["private_key"],
        algorithm="RS256",
        headers={"kid": c["private_key_id"]},
    )
    r = client.post(c["token_uri"], data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion})
    r.raise_for_status()
    body = r.json()
    _token.update(value=body["access_token"], exp=now + int(body.get("expires_in", 3600)))
    return _token["value"]


def send(token: str, title: str, body: str, data: dict[str, str], client: httpx.Client | None = None) -> str:
    """Returns 'ok', 'gone' (token no longer valid — drop it) or 'error'."""
    client = client or httpx.Client(timeout=15)
    c = _creds()
    msg = {
        "message": {
            "token": token,
            "notification": {"title": title, "body": body},
            "data": {k: str(v) for k, v in data.items()},
            "android": {"priority": "HIGH", "notification": {"channel_id": "alerts", "color": "#F0A63A"}},
        }
    }
    r = client.post(
        f"https://fcm.googleapis.com/v1/projects/{c['project_id']}/messages:send",
        json=msg,
        headers={"Authorization": f"Bearer {_access_token(client)}"},
    )
    if r.status_code == 200:
        return "ok"
    if r.status_code in (404, 410) or "UNREGISTERED" in r.text:
        return "gone"
    log.warning("fcm send failed %s: %s", r.status_code, r.text[:300])
    return "error"

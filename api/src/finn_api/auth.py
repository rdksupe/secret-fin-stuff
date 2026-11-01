"""API auth.

The app unlocks with a password: `POST /api/auth/login {password}` checks it against a salted
scrypt hash kept only on the server (`data/app_password.json`, set with `finn password set`) and
mints a JWT (HS256, signed with FINN_JWT_SECRET, audience `finn-app`, 30 days) that the app keeps in
secure storage and sends as `Authorization: Bearer <jwt>`.

App tokens carry `via: "password"` and the password's version `pv`. Changing the password bumps
the version, which revokes every token minted under the old one; tokens without `via` (the old
build-time tokens) are refused. `X-API-Key` remains for server-side tools on the same host.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from finn_api.config import settings

AUDIENCE = "finn-app"
ALGO = "HS256"
TOKEN_DAYS = 30
_SCRYPT = {"n": 2**14, "r": 8, "p": 1}  # ~16 MB per check: fine on the 1 GB worker


def _password_file():
    return settings.finn_kb_dir.parent / "data" / "app_password.json"


def _load_password() -> dict | None:
    try:
        return json.loads(_password_file().read_text())
    except (OSError, ValueError):
        return None


def set_password(plain: str) -> int:
    """Store a new password (hash only) and bump its version, revoking every existing app token."""
    if len(plain) < 10:
        raise ValueError("use at least 10 characters")
    old = _load_password() or {}
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(plain.encode(), salt=salt, **_SCRYPT, dklen=32)
    rec = {"salt": salt.hex(), "hash": digest.hex(), "version": int(old.get("version", 0)) + 1, **_SCRYPT}
    p = _password_file()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(rec))
    os.chmod(tmp, 0o600)
    tmp.replace(p)
    return rec["version"]


def check_password(plain: str) -> int | None:
    """The password's version if it matches, else None. Constant-time comparison."""
    rec = _load_password()
    if not rec or not plain:
        return None
    digest = hashlib.scrypt(plain.encode(), salt=bytes.fromhex(rec["salt"]),
                            n=rec.get("n", _SCRYPT["n"]), r=rec.get("r", 8), p=rec.get("p", 1), dklen=32)
    return int(rec["version"]) if hmac.compare_digest(digest.hex(), rec["hash"]) else None


def mint(subject: str, days: int = TOKEN_DAYS, *, pv: int | None = None) -> str:
    if not settings.finn_jwt_secret:
        raise RuntimeError("FINN_JWT_SECRET is not set")
    now = datetime.now(UTC)
    claims = {"sub": subject, "aud": AUDIENCE, "iat": now, "exp": now + timedelta(days=days)}
    if pv is not None:
        claims |= {"via": "password", "pv": pv}
    return jwt.encode(claims, settings.finn_jwt_secret, algorithm=ALGO)


def verify(token: str) -> dict:
    claims = jwt.decode(token, settings.finn_jwt_secret, algorithms=[ALGO], audience=AUDIENCE)
    rec = _load_password()
    # Once a password exists, only tokens it minted (current version) are accepted.
    if rec and (claims.get("via") != "password" or claims.get("pv") != rec.get("version")):
        raise jwt.InvalidTokenError("token predates the current password")
    return claims


def require_auth(
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
) -> dict:
    if authorization and authorization.lower().startswith("bearer "):
        if not settings.finn_jwt_secret:
            raise HTTPException(503, "auth not configured")
        try:
            return verify(authorization[7:].strip())
        except jwt.ExpiredSignatureError as e:
            raise HTTPException(401, "session expired: unlock FINN again") from e
        except jwt.InvalidTokenError as e:
            raise HTTPException(401, "locked: unlock FINN with the password") from e
    if x_api_key and settings.finn_api_key and x_api_key == settings.finn_api_key:
        return {"sub": "server"}
    raise HTTPException(401, "locked: unlock FINN with the password")


# ── login (the only unauthenticated route) ─────────────────────────────────

public = APIRouter(prefix="/api")
_fails: dict[str, deque] = defaultdict(deque)
WINDOW, MAX_FAILS = 600, 6  # six wrong passwords per 10 minutes per client


class LoginIn(BaseModel):
    password: str
    device: str | None = None  # a label for the install, kept in the token's subject


def _client(request: Request) -> str:
    # Behind the Caddy edge the peer is the edge; it forwards the real client address.
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() or (request.client.host if request.client else "?")


@public.post("/auth/login")
def login(body: LoginIn, request: Request):
    who = _client(request)
    q = _fails[who]
    now = time.monotonic()
    while q and now - q[0] > WINDOW:
        q.popleft()
    if len(q) >= MAX_FAILS:
        raise HTTPException(429, "too many attempts: wait a few minutes and try again")
    if not _load_password():
        raise HTTPException(503, "FINN has no password set yet")
    pv = check_password(body.password)
    if pv is None:
        q.append(now)
        raise HTTPException(401, "that password isn't right")
    q.clear()
    device = "".join(c for c in (body.device or "app") if c.isalnum() or c in "-_")[:40] or "app"
    exp = datetime.now(UTC) + timedelta(days=TOKEN_DAYS)
    return {"token": mint(f"app:{device}", pv=pv), "expires_at": exp.isoformat()}

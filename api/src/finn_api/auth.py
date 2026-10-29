"""API auth.

The app sends `Authorization: Bearer <jwt>` — HS256, signed with FINN_JWT_SECRET (server only),
audience `finn-app`, with an expiry. Tokens are minted with `finn token` and baked into the app
build. `X-API-Key` remains for server-side tools on the same host (crons, scripts).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Header, HTTPException

from finn_api.config import settings

AUDIENCE = "finn-app"
ALGO = "HS256"


def mint(subject: str, days: int = 30) -> str:
    if not settings.finn_jwt_secret:
        raise RuntimeError("FINN_JWT_SECRET is not set")
    now = datetime.now(UTC)
    return jwt.encode(
        {"sub": subject, "aud": AUDIENCE, "iat": now, "exp": now + timedelta(days=days)},
        settings.finn_jwt_secret,
        algorithm=ALGO,
    )


def verify(token: str) -> dict:
    return jwt.decode(token, settings.finn_jwt_secret, algorithms=[ALGO], audience=AUDIENCE)


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
            raise HTTPException(401, "token expired — rebuild the app with a fresh token") from e
        except jwt.InvalidTokenError as e:
            raise HTTPException(401, "invalid token") from e
    if x_api_key and settings.finn_api_key and x_api_key == settings.finn_api_key:
        return {"sub": "server"}
    raise HTTPException(401, "send Authorization: Bearer <token>")

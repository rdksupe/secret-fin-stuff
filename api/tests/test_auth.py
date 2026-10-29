from datetime import UTC, datetime, timedelta

import jwt
import pytest
from fastapi import HTTPException

from finn_api import auth
from finn_api.config import settings


@pytest.fixture(autouse=True)
def secret(monkeypatch):
    monkeypatch.setattr(settings, "finn_jwt_secret", "test-secret-" + "x" * 32)
    monkeypatch.setattr(settings, "finn_api_key", "server-key")


def test_bearer_token_roundtrip():
    tok = auth.mint("demo", days=1)
    assert auth.require_auth(authorization=f"Bearer {tok}", x_api_key=None)["sub"] == "demo"


def test_rejects_expired_wrong_audience_and_missing():
    expired = jwt.encode({"sub": "x", "aud": auth.AUDIENCE, "exp": datetime.now(UTC) - timedelta(days=1)},
                         settings.finn_jwt_secret, algorithm="HS256")
    wrong_aud = jwt.encode({"sub": "x", "aud": "other", "exp": datetime.now(UTC) + timedelta(days=1)},
                           settings.finn_jwt_secret, algorithm="HS256")
    forged = jwt.encode({"sub": "x", "aud": auth.AUDIENCE, "exp": datetime.now(UTC) + timedelta(days=1)},
                        "not-the-secret-" + "y" * 32, algorithm="HS256")
    for bad in (expired, wrong_aud, forged):
        with pytest.raises(HTTPException) as e:
            auth.require_auth(authorization=f"Bearer {bad}", x_api_key=None)
        assert e.value.status_code == 401
    with pytest.raises(HTTPException):
        auth.require_auth(authorization=None, x_api_key=None)


def test_server_key_still_works_for_local_tools():
    assert auth.require_auth(authorization=None, x_api_key="server-key")["sub"] == "server"

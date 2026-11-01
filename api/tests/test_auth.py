from datetime import UTC, datetime, timedelta

import jwt
import pytest
from fastapi import HTTPException

from finn_api import auth
from finn_api.config import settings


@pytest.fixture(autouse=True)
def secret(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "finn_jwt_secret", "test-secret-" + "x" * 32)
    monkeypatch.setattr(settings, "finn_api_key", "server-key")
    # The password lives in <repo>/data; point that at a temp dir for every test.
    monkeypatch.setattr(settings, "finn_kb_dir", tmp_path / "kb")
    auth._fails.clear()


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


def _client():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(auth.public)
    return TestClient(app)


def test_login_mints_a_password_token():
    auth.set_password("correct horse battery")
    r = _client().post("/api/auth/login", json={"password": "correct horse battery", "device": "pixel 9!"})
    assert r.status_code == 200
    claims = auth.require_auth(authorization=f"Bearer {r.json()['token']}", x_api_key=None)
    assert claims["via"] == "password" and claims["pv"] == 1 and claims["sub"] == "app:pixel9"


def test_wrong_password_and_throttle():
    auth.set_password("correct horse battery")
    c = _client()
    for _ in range(auth.MAX_FAILS):
        assert c.post("/api/auth/login", json={"password": "nope"}).status_code == 401
    # Locked out even with the right password until the window passes.
    assert c.post("/api/auth/login", json={"password": "correct horse battery"}).status_code == 429


def test_password_change_revokes_tokens_and_old_build_tokens_are_refused():
    old_build_token = auth.mint("finn-app", days=30)  # baked into earlier APKs: no via/pv
    auth.set_password("first password!")
    tok = _client().post("/api/auth/login", json={"password": "first password!"}).json()["token"]
    assert auth.require_auth(authorization=f"Bearer {tok}", x_api_key=None)
    with pytest.raises(HTTPException):
        auth.require_auth(authorization=f"Bearer {old_build_token}", x_api_key=None)
    auth.set_password("second password!")
    with pytest.raises(HTTPException):
        auth.require_auth(authorization=f"Bearer {tok}", x_api_key=None)


def test_no_password_set_is_503_and_short_passwords_rejected():
    assert _client().post("/api/auth/login", json={"password": "anything"}).status_code == 503
    with pytest.raises(ValueError):
        auth.set_password("short")

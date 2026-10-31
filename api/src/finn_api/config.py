from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# api/src/finn_api → repo root
REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", str(REPO_ROOT / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    finn_api_key: str | None = None  # server-side tools only
    finn_jwt_secret: str | None = None  # signs app tokens; never leaves the server
    finn_db_path: Path = REPO_ROOT / "data" / "finn.db"
    finn_kb_dir: Path = REPO_ROOT / "kb"
    # Raw HTTP responses from NSE etc. — lets the demo survive upstream blocking.
    finn_cache_dir: Path = REPO_ROOT / "data" / "cache"

    fireworks_api_key: str | None = None
    finn_model_cheap: str = "accounts/fireworks/models/glm-5p3-flash"
    finn_model_reason: str = "accounts/fireworks/models/kimi-k3"

    datalab_api_key: str | None = None
    datalab_mode: str = "accurate"  # Chandra
    typesafe_api_key: str | None = None
    pageindex_root: Path = REPO_ROOT.parent / "PageIndex"
    exa_api_key: str | None = None
    finn_fcm_credentials: str | None = None
    smallest_api_key: str | None = None  # speech in/out (same provider Hermes uses)
    finn_audio_dir: Path = REPO_ROOT / "data" / "audio"  # path to an FCM-only service-account JSON

    finn_app_bridge_url: str = "http://127.0.0.1:8650"  # Hermes finn_app adapter listener
    finn_app_bridge_secret: str | None = None
    hermes_api_url: str = "http://127.0.0.1:8642"
    hermes_api_key: str | None = None


settings = Settings()

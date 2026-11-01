import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from finn_api.conversation import router as conversation_router
from finn_api.db import init_db
from finn_api.routes import router

log = logging.getLogger("finn")


def _warm_prices() -> None:
    """Parse the last ~60 sessions once so Watch/Company sparklines answer instantly."""
    from finn_api.sources.nse import NSE

    try:
        NSE().recent_bhavcopies(60)
    except Exception as e:  # warm-up is best effort
        log.warning("price warm-up failed: %s", e)


def _write_portfolio() -> None:
    from finn_api import portfolio_context
    from finn_api.db import SessionLocal

    with SessionLocal() as db:
        portfolio_context.write(db)


def _warm_brains() -> None:
    """Build every brain's search index up front so the first search isn't the slow one."""
    from finn_api.brain import Brain
    from finn_api.config import settings
    from finn_api.routes import _brain_index

    root = settings.finn_kb_dir / "companies"
    for d in sorted(root.iterdir()) if root.is_dir() else []:
        try:
            b = Brain(d.name)
            if b.exists:
                _brain_index(b)
        except Exception as e:  # best effort
            log.warning("brain index warm-up failed for %s: %s", d.name, e)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    _write_portfolio()
    threading.Thread(target=_warm_prices, daemon=True).start()
    threading.Thread(target=_warm_brains, daemon=True).start()
    yield


app = FastAPI(title="FINN API", version="0.1.0", lifespan=lifespan)
# The Expo web build and the native app call from other origins; auth is the API key.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
app.include_router(conversation_router)


@app.get("/health")
def health():
    return {"ok": True, "service": "finn-api"}

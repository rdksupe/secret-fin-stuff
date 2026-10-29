import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from finn_api.db import init_db
from finn_api.routes import router

log = logging.getLogger("finn")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
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


@app.get("/health")
def health():
    return {"ok": True, "service": "finn-api"}

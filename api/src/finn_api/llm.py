"""Fireworks chat for the few calls FINN makes outside Hermes (filing triage).

Reasoning models can spend their whole budget thinking and return no content, so
every call has a fallback chain. Token usage is logged per feature for the cost ledger.
"""

from __future__ import annotations

import json
import logging
import re

import httpx
from sqlalchemy.orm import Session

from finn_api.config import settings
from finn_api.models import LLMCall

log = logging.getLogger("finn.llm")
URL = "https://api.fireworks.ai/inference/v1/chat/completions"


def chat_json(
    system: str,
    user: str,
    *,
    feature: str,
    db: Session | None = None,
    models: tuple[str, ...] | None = None,
    max_tokens: int = 4000,
    effort: str | None = "low",
) -> dict | None:
    """`effort` caps the model's hidden reasoning. Reading and extraction need "low" — left
    unset, these thinking models can spend the whole budget thinking and return nothing.
    Pass None for genuine reasoning steps."""
    models = models or (settings.finn_model_cheap, settings.finn_model_reason)
    for model in models:
        body = {
            "model": model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "response_format": {"type": "json_object"},
            "max_tokens": max_tokens,
            "temperature": 0,
        }
        if effort:
            body["reasoning_effort"] = effort
        try:
            r = httpx.post(URL, json=body, timeout=180,
                           headers={"Authorization": f"Bearer {settings.fireworks_api_key}"})
            r.raise_for_status()
            res = r.json()
        except (httpx.HTTPError, ValueError) as e:
            log.warning("%s on %s failed: %s", feature, model, e)
            continue
        usage = res.get("usage", {})
        if db is not None:
            db.add(LLMCall(feature=feature, model=model.rsplit("/", 1)[-1],
                           input_tokens=usage.get("prompt_tokens", 0),
                           output_tokens=usage.get("completion_tokens", 0)))
        content = (res.get("choices") or [{}])[0].get("message", {}).get("content")
        m = re.search(r"\{.*\}", content or "", re.S)
        if not m:
            continue  # thought itself out of budget — try the next model
        try:
            out = json.loads(m.group(0))
            out["_model"] = model.rsplit("/", 1)[-1]
            return out
        except ValueError:
            continue
    return None

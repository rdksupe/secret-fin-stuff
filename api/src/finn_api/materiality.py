"""Is this filing material to someone holding the stock? Rules → Jev → LLM cascade.

1. Rules (taxonomy) settle the obvious: routine compliance, results, management, defaults.
2. Jev answers six atomic yes/no questions about the filing in one call (~$0.00005);
   code combines them. Clear-adverse and clear-benign stop here.
3. Only the uncertain band goes to an LLM, which reads past corporate framing and
   writes the one-liner. Its verdict decides the push.

Design follows TypeSafe's guidance: JSON state with the company's own description,
boilerplate stripped in code, one judgment per Noul, composite scoring in code,
0.3–0.7 treated as "unsure" rather than "no".
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field

import httpx
from sqlalchemy.orm import Session

from finn_api import llm
from finn_api.config import settings
from finn_api.models import LLMCall
from finn_api.sources import jev, pdf, screener

log = logging.getLogger("finn.materiality")

NOULS: dict[str, str | dict] = {
    "incident": "The filing reports an incident, failure, breach, default, or problem that has already happened "
                "to the company or its products",
    "third_party_action": "A regulator, government body, lender, rating agency, auditor, court, police, or technology "
                          "platform has taken or announced an action against the company or its products",
    "core_business": {
        "instructions": "The product, licence, or business affected by this filing is one of the main businesses "
                        "named in company.description",
        "criteria": {
            "true": "The affected item is the company's main product, licence, or line of business as described",
            "false": "The filing affects a side activity, a subsidiary's minor operation, a new expansion, "
                     "or no specific business",
        },
    },
    "stops_activity": "The company is exiting, stopping, suspending, or losing permission for a product, business, "
                      "licence, or facility",
    "claims_immaterial": "The company states that the impact is not material, is limited, or that operations are "
                         "unaffected",
    "routine": "The filing is a routine compliance, scheduling, governance-code, or certificate disclosure with no "
               "new business event",
}

ADVERSE_AT, CLEAR_AT = 0.6, 0.25

LLM_SYSTEM = (
    "You triage stock-exchange filings for an investor who HOLDS this stock. "
    'Return JSON only: {"one_liner": str (<=160 chars, what changed and why it matters), '
    '"importance": number 0-1 (how much a holder should care today), '
    '"direction": "negative"|"neutral"|"positive", "push_now": bool}. '
    "Look past corporate framing: judge the economic substance for this company's business, "
    "including second-order effects such as loss of trust in the company's core product."
)


@dataclass
class Assessment:
    stage: str  # rules | jev | llm
    verdict: str  # adverse | clear | uncertain | material | not_material
    score: float | None = None
    nouls: dict[str, float] = field(default_factory=dict)
    llm: dict | None = None

    @property
    def push(self) -> bool:
        if self.llm:
            neg = self.llm.get("direction") == "negative"
            return bool(self.llm.get("push_now")) or (neg and float(self.llm.get("importance", 0)) >= 0.5)
        return self.verdict == "adverse"

    def as_dict(self) -> dict:
        return {"stage": self.stage, "verdict": self.verdict, "score": self.score,
                "nouls": self.nouls, "llm": self.llm, "push": self.push}


def build_state(ann: dict, description: str, text: str) -> dict:
    return {
        "company": {"name": ann.get("sm_name"), "symbol": ann.get("symbol"), "description": description},
        "filing": {"category": ann.get("desc"), "exchange_summary": ann.get("attchmntText")},
        "body": text,
    }


def combine(n: dict[str, float]) -> tuple[float, str]:
    """Hand-set composite. `finn train-materiality` may replace these weights with learned ones."""
    if n["routine"] >= 0.7:
        return 0.0, "clear"
    hit = max(n["incident"], n["third_party_action"], n["stops_activity"])
    score = hit * (0.55 + 0.45 * n["core_business"])
    if n["claims_immaterial"] >= 0.7 and n["core_business"] < 0.5:
        score *= 0.6
    score = round(score, 3)
    return score, "adverse" if score >= ADVERSE_AT else "clear" if score <= CLEAR_AT else "uncertain"


def jev_nouls(state: dict, db: Session | None = None) -> dict[str, float] | None:
    if not jev.available():
        return None
    qs = {k: {"type": "noul", **({"instructions": v} if isinstance(v, str) else v)} for k, v in NOULS.items()}
    try:
        r = httpx.post(jev.URL, timeout=30, headers={"Authorization": f"Bearer {settings.typesafe_api_key}"},
                       json={"model": jev.MODEL, "state": state, "questions": qs})
        r.raise_for_status()
        data = r.json()
    except (httpx.HTTPError, ValueError) as e:
        log.warning("jev materiality failed: %s", e)
        return None
    tokens = int(data.get("usage", {}).get("input_tokens", 0))
    if db is not None:
        db.add(LLMCall(feature="materiality_jev", model=jev.MODEL, input_tokens=tokens,
                       cost_usd=tokens / 1e6 * jev.PRICE_PER_M_INPUT))
    return {k: float(v["noul"]) for k, v in data["answers"].items()}


def llm_triage(state: dict, db: Session | None = None) -> dict | None:
    c, f = state["company"], state["filing"]
    user = (f"Company: {c['name']} (NSE: {c['symbol']})\nWhat the company does: {c['description']}\n"
            f"Filing category: {f['category']}\nExchange summary: {f['exchange_summary']}\n"
            f"--- filing text ---\n{state['body']}")
    return llm.chat_json(LLM_SYSTEM, user, feature="materiality_llm", db=db)


def assess(ann: dict, raw_pdf: bytes | None, *, db: Session | None = None, use_llm: bool = True) -> Assessment:
    """Full cascade for one filing (rules already decided it's worth a look)."""
    text = ""
    if raw_pdf:
        try:
            pages, _ = pdf.pages_text(raw_pdf, limit=3)
            text = pdf.body(pages)
        except Exception as e:
            log.info("pdf unreadable for %s: %s", ann.get("symbol"), e)
    state = build_state(ann, screener.about(ann.get("symbol", "")), text or (ann.get("attchmntText") or ""))
    n = jev_nouls(state, db)
    if n is None:
        a = Assessment(stage="rules", verdict="uncertain")
    else:
        score, verdict = combine(n)
        a = Assessment(stage="jev", verdict=verdict, score=score, nouls=n)
    if a.verdict == "uncertain" and use_llm:
        out = llm_triage(state, db)
        if out:
            a.stage, a.llm = "llm", out
            a.verdict = "material" if a.push else "not_material"
    return a


def to_json(a: Assessment) -> str:
    return json.dumps(a.as_dict(), ensure_ascii=False)

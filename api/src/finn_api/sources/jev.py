"""PDF triage with TypeSafe Jev (System One): typed decisions, no text generation.

One call per PDF, three questions answered in parallel against the same state
(filing category + exchange text + filename + page count + first ~2 pages):

  doc_type        choice — what the document is
  substantive     noul   — contains numbers / guidance / strategy beyond boilerplate
  research_value  score  — none / context / core research document

`classify_pdf` returns None when Jev is unavailable; callers fall back to rules.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from finn_api.config import settings

log = logging.getLogger("finn.jev")
URL = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-latest"
PRICE_PER_M_INPUT = 0.042  # USD, output is free

DOC_TYPES: dict[str, str] = {
    "transcript": "Verbatim earnings-call or analyst-meet transcript: moderator, management remarks, Q&A",
    "call_notice": "Notice or schedule that a call/analyst meet WILL happen (date, dial-in), or a list of attendees — no discussion content",
    "results": "Financial results statement: P&L / balance sheet tables for a quarter or year, auditor review report",
    "presentation": "Investor presentation / fact sheet: slides with charts, KPIs, segment numbers, strategy",
    "annual_report": "Annual report or integrated report: chairman letter, MD&A, full financial statements",
    "press_release": "Press release or media statement about a business event, product or results",
    "order_contract": "Order win, contract award, letter of award, agreement or MoU",
    "management_change": "Appointment, resignation, cessation of a director, CEO, CFO or key managerial person",
    "corporate_action": "Dividend, buyback, split, bonus, rights, fund raise, allotment, record date",
    "mna": "Acquisition, merger, demerger, stake sale, scheme of arrangement",
    "rating": "Credit rating action from a rating agency",
    "legal_regulatory": "Litigation, regulatory order, penalty, tax demand, show-cause notice",
    "routine_compliance": "Boilerplate compliance certificate, trading window, newspaper ad, share certificate loss, Reg 74(5)",
    "other": "Anything that fits none of the above",
}

RESEARCH_VALUE = [
    "No research value: boilerplate, notices, compliance",
    "Context: useful to know, but not a primary research source",
    "Core research document: management's own numbers, guidance, strategy or detailed financials",
]


@dataclass(frozen=True)
class Triage:
    doc_type: str
    doc_type_confidence: float
    substantive: float
    research_value: float  # 0..1 (expected score / 2)
    probabilities: dict[str, float]
    input_tokens: int

    @property
    def cost_usd(self) -> float:
        return self.input_tokens / 1e6 * PRICE_PER_M_INPUT


def available() -> bool:
    return bool(settings.typesafe_api_key)


def classify_pdf(state: str, *, client: httpx.Client | None = None) -> Triage | None:
    if not available():
        return None
    body = {
        "model": MODEL,
        "state": state[:12000],
        "questions": {
            "doc_type": {
                "type": "choice",
                "instructions": "What kind of stock-exchange filing document is this",
                "criteria": DOC_TYPES,
            },
            "substantive": {
                "type": "noul",
                "instructions": "The document contains specific numbers, guidance, or strategy discussion "
                                "beyond boilerplate legal or compliance text",
            },
            "research_value": {
                "type": "score",
                "instructions": "How useful this document is to an investor researching the company's fundamentals",
                "criteria": RESEARCH_VALUE,
            },
        },
    }
    c = client or httpx.Client(timeout=20)
    try:
        r = c.post(URL, json=body, headers={"Authorization": f"Bearer {settings.typesafe_api_key}"})
        r.raise_for_status()
        data = r.json()
    except (httpx.HTTPError, ValueError) as e:
        log.warning("jev unavailable: %s", e)
        return None
    a = data["answers"]
    return Triage(
        doc_type=a["doc_type"]["choice"],
        doc_type_confidence=float(a["doc_type"].get("confidence", 0)),
        substantive=float(a["substantive"]["noul"]),
        research_value=float(a["research_value"]["score"]) / (len(RESEARCH_VALUE) - 1),
        probabilities=a["doc_type"].get("probabilities", {}),
        input_tokens=int(data.get("usage", {}).get("input_tokens", 0)),
    )

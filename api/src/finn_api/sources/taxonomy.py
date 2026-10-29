"""Rules-first classification of NSE announcements.

NSE's `desc` field is a coarse filing category. Most of it maps cleanly; a few
generic buckets ("Outcome of Board Meeting", "Updates", "General Updates",
"Press Release") need a look at `attchmntText`. No LLM is involved — this runs
on every announcement in the market, every cron tick.

Tiers drive presentation:
  3  alert   — push it, and enrich (results card, person bio, one-liner)
  2  brief   — expanded in the digest with a one-line summary
  1  list    — shown at its priority, filing link only
  0  routine — collapsed into "N routine" in the digest
"""

from __future__ import annotations

import re
from dataclasses import dataclass

ALERT, BRIEF, LIST, ROUTINE = 3, 2, 1, 0


@dataclass(frozen=True)
class Category:
    key: str
    label: str
    tier: int


RESULTS = Category("results", "Results", ALERT)
MANAGEMENT = Category("management", "Management change", ALERT)
MNA = Category("mna", "M&A / restructuring", ALERT)
DISTRESS = Category("distress", "Default / insolvency", ALERT)
RATING = Category("rating", "Credit rating", BRIEF)
ORDERS = Category("orders", "Orders & contracts", BRIEF)
CAPITAL = Category("capital", "Capital action", BRIEF)
LEGAL = Category("legal", "Legal & regulatory", BRIEF)
BUSINESS = Category("business", "Business update", BRIEF)
AUDITOR = Category("auditor", "Auditor change", BRIEF)
GOVERNANCE = Category("governance", "Board & governance", LIST)
INVESTOR = Category("investor", "Investor communication", LIST)
MEETING = Category("meeting", "Con-call / analyst meet", ROUTINE)
COMPLIANCE = Category("compliance", "Routine compliance", ROUTINE)
OTHER = Category("other", "Other", LIST)

CATEGORIES = {
    c.key: c
    for c in (
        RESULTS, MANAGEMENT, MNA, DISTRESS, RATING, ORDERS, CAPITAL, LEGAL,
        BUSINESS, AUDITOR, GOVERNANCE, INVESTOR, MEETING, COMPLIANCE, OTHER,
    )
}

# Exact NSE `desc` → category. Built from a real week (22–29 Oct 2026, 4,420 filings).
_BY_DESC: dict[str, Category] = {
    "Integrated Filing- Financial": RESULTS,
    "Financial Result Updates": RESULTS,
    "Reasons for Delayed/Non-submission of Financial Results": DISTRESS,
    "Change in Management": MANAGEMENT,
    "Appointment": MANAGEMENT,
    "Resignation": MANAGEMENT,
    "Resignation of Director/KMP/SMP": MANAGEMENT,
    "Cessation": MANAGEMENT,
    "Retirement": MANAGEMENT,
    "Demise": MANAGEMENT,
    "Change in Director(s)": MANAGEMENT,
    "Change in Company Secretary/Compliance Officer": GOVERNANCE,
    "Acquisition": MNA,
    "Amalgamation/Merger": MNA,
    "Scheme of Arrangement": MNA,
    "Sale or disposal": MNA,
    "Diversification/Disinvestment": MNA,
    "Other Restructuring": MNA,
    "Disclosure under SEBI Takeover Regulations": MNA,
    "Arrangements for strategic, technical, manufacturing, or marketing tie up": ORDERS,
    "Corporate Insolvency Resolution Process": DISTRESS,
    "Defaults on Payment of Interest/Principal": DISTRESS,
    "Closure of operations": DISTRESS,
    "Suspension of Trading": DISTRESS,
    "Credit Rating": RATING,
    "Credit Rating- Revision": RATING,
    "Credit Rating- New": RATING,
    "Credit Rating- Others": RATING,
    "Bagging/Receiving of orders/contracts": ORDERS,
    "Awarding of order(s)/contract(s)": ORDERS,
    "Agreements": ORDERS,
    "Dividend": CAPITAL,
    "Buyback": CAPITAL,
    "Public Announcement - Buyback of Shares": CAPITAL,
    "Rights Issue": CAPITAL,
    "Preferential issue": CAPITAL,
    "Issue of Securities": CAPITAL,
    "Stock split": CAPITAL,
    "Bonus": CAPITAL,
    "Action(s) taken or orders passed": LEGAL,
    "Action(s) initiated or orders passed": LEGAL,
    "Pendency of Litigation(s)/dispute(s) or the outcome impacting the Company": LEGAL,
    "Disclosure of material issue": LEGAL,
    "Granting/withdrawal/surrender/cancellation/suspension of key licenses/ regulatory approvals": LEGAL,
    "Change in Auditors": AUDITOR,
    "Resignation of Statutory Auditor": AUDITOR,
    "Capacity addition": BUSINESS,
    "Commencement of commercial production/operations": BUSINESS,
    "Product launch": BUSINESS,
    "Monthly Business Updates": BUSINESS,
    "Investor Presentation": INVESTOR,
    "Shareholders meeting": GOVERNANCE,
    "Committee Meeting Updates": GOVERNANCE,
    "Amendment to AOA/MOA": GOVERNANCE,
    "Name Change": GOVERNANCE,
    "Related Party Transactions": GOVERNANCE,
    "Giving guarantees/indemnity/ becoming a surety for third party": GOVERNANCE,
    "Price movement": INVESTOR,
    "Spurt in Volume": INVESTOR,
    "News Verification": INVESTOR,
    "Analysts/Institutional Investor Meet/Con. Call Updates": MEETING,
    "Copy of Newspaper Publication": COMPLIANCE,
    "Trading Window": COMPLIANCE,
    "Record Date": COMPLIANCE,
    "ESOP/ESOS/ESPS": COMPLIANCE,
    "Allotment of Securities": COMPLIANCE,
    "Options to purchase securities": COMPLIANCE,
    "Monitoring Agency Report": COMPLIANCE,
    "Statement of deviation(s) or variation(s) under Reg. 32": COMPLIANCE,
    "Certificate under SEBI (Depositories and Participants) Regulations, 2018": COMPLIANCE,
    "Loss of Share Certificates": COMPLIANCE,
    "Structural Digital Database": COMPLIANCE,
    "Utilisation of Funds": COMPLIANCE,
    "Corrigendum": COMPLIANCE,
    "Extension  of Financial Year": GOVERNANCE,
    "Fraud/Default/Arrest": DISTRESS,
    "Disruption of Operations": BUSINESS,
    "Strikes/Lockouts/Disturbances": BUSINESS,
    "Name and Symbol Change": GOVERNANCE,
    "Increase in Authorised Capital": COMPLIANCE,
}

# Generic buckets: first matching text rule wins.
_GENERIC = {"Outcome of Board Meeting", "Updates", "General Updates", "Press Release",
            "Press Release (Revised)", "Others", "Amendment(s)"}
_RESULTS_TEXT = re.compile(r"financial results?|unaudited results|audited results", re.I)
# Only the board outcome *is* the results; press releases and decks about the
# results are companions — grouped under the results story, not separate alerts.
_RESULTS_SOURCES = {"Outcome of Board Meeting", "Others", "Amendment(s)"}
_TEXT_RULES: list[tuple[re.Pattern[str], Category]] = [
    (re.compile(r"\b(appoint|resign|cessation|re-?designat|chief (executive|financial)|managing director|\bceo\b|\bcfo\b)", re.I), MANAGEMENT),
    (re.compile(r"acqui|merger|amalgamat|demerger|divest|stake|scheme of arrangement", re.I), MNA),
    (re.compile(r"order|contract|letter of award|\bLoA\b|bagg", re.I), ORDERS),
    (re.compile(r"dividend|buy-?back|bonus|split|rights issue|fund rais|qip|preferential", re.I), CAPITAL),
    (re.compile(r"rating", re.I), RATING),
    (re.compile(r"penalt|show cause|\bSEBI\b order|tax demand|litigation|search|survey", re.I), LEGAL),
    (re.compile(r"launch|capacity|plant|commission|expan|business update", re.I), BUSINESS),
    (re.compile(r"newspaper|trading window|record date|loss of share", re.I), COMPLIANCE),
    (re.compile(r"analyst|investor meet|con\.? ?call|earnings call", re.I), MEETING),
]


def classify(desc: str, text: str = "") -> Category:
    desc = (desc or "").strip()
    if desc in _BY_DESC:
        return _BY_DESC[desc]
    if _RESULTS_TEXT.search(text or ""):
        return RESULTS if desc in _RESULTS_SOURCES else INVESTOR
    if desc in _GENERIC or desc not in _BY_DESC:
        for pattern, cat in _TEXT_RULES:
            if pattern.search(text or ""):
                return cat
    if desc in ("Outcome of Board Meeting",):
        return GOVERNANCE
    if desc.startswith("Press Release"):
        return INVESTOR
    return OTHER

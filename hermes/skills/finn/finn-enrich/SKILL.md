---
name: finn-enrich
description: Cron-time enrichment of material exchange filings — one-line "why it matters" summaries and incoming-executive bios — written back with `finn enrich`. Used by the finn-announcements cron when its script wakes the agent.
version: 0.1.0
---

# finn-enrich

The `finn-announcements` cron script already did the fetching, classification,
dedup and brain writes. You get **only** the items it could not finish, one JSON
object per line:

```json
{"feed_id": "…", "symbol": "TCS", "category": "management", "desc": "Change in Management",
 "text": "…exchange summary…", "pdf": "https://nsearchives.nseindia.com/…pdf"}
```

Do each item, then stop. Do not post anything anywhere else; delivery is handled.

## For every item: the one-liner

Write ≤ 160 characters: **what changed, and the number or name that matters**.
- Good: `Acquires 100% of BBY Services (Germany) for €210M; adds ~1.2% to FY27 revenue run-rate`
- Bad: `TCS has informed the Exchange regarding an acquisition.`

If the exchange text is a stub ("has informed the Exchange about…"), read the PDF
first with the `finn_filing_text` tool (`url` = the item's `pdf`). Don't use the shell.
If the PDF still says nothing specific, write the most specific line you can and set importance low.

`importance` (0–1): how much a holder should care. Routine re-appointment 0.2,
CFO exit 0.7, CEO exit 0.9, acquisition >5% of market cap 0.8, rating downgrade 0.7.

## Management changes: the bio

Find the **incoming** person (or the departing one if there is no successor yet)
in the filing. Then search the web for their career (this is the only use of web
search FINN allows):

```
web_search("<Full Name> <Company> <role> LinkedIn")
```

Write a 2–3 sentence bio: current/previous roles with company names and years,
education if notable. Cite 1–3 URLs. If results are ambiguous (common name), say
"could not confirm identity" instead of guessing.

## Write back

Call the `finn_enrich` tool once per item:

```json
{"feed_id": "…", "summary": "CFO to step down 31 Dec; successor named from within the finance team",
 "importance": 0.7,
 "person": {"name": "…", "role": "CFO (incoming)", "change": "appointed", "bio": "…", "sources": ["https://…"]}}
```

`finn_enrich` updates every holder's copy of the item, writes `people/{name}.md` in
the company brain, and releases the push notification it was holding.

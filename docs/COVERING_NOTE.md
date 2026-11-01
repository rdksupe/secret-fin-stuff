# FINN — covering note

**Try it:** install the Android app from the latest GitHub release, take the tour, and unlock with the password that came with this note. The backend runs on Oracle Cloud and has been reading NSE continuously since 30 October. Every filing, price and result in the app is live NSE data for an 18-company portfolio.

## What FINN is

FINN is an always-on investor agent, not a dashboard. It runs on **Hermes** (Nous Research's agent runtime), which gives it a persistent identity (`SOUL.md`), skills, tools, memory, a scheduler and messaging channels. The Android app is one of those channels, implemented as a Hermes **gateway platform adapter** (`finn_app`), the same way Telegram is. Everything the app shows is either something FINN's crons found on their own (push) or something the agent answered when asked (pull).

```
 NSE (announcements, XBRL, bhavcopy, archives) ─┐
 Screener docs index → BSE / company IR PDFs  ──┤
 Exa web search ────────────────────────────────┤
                                                ▼
   Hermes crons (script-gated) ──► FINN API (FastAPI + SQLite) ──► FCM push ──► Android app
            │                           ▲    │                                      │
            ▼                           │    ▼                                      │
   Hermes agent (SOUL + skills + FINN tools) ◄── finn_app gateway adapter ◄─────────┘
            │                (chat, streaming, tool trace, reactions, media)
            ▼
   kb/companies/{SYMBOL}/wiki/  ← the company "brains" (markdown, FTS5-indexed)
```

## Proactive by design: Hermes crons

Push is not a separate service. It is Hermes's own scheduler running FINN jobs, timezone `Asia/Kolkata`:

| Job | Schedule (IST) | What it does |
|---|---|---|
| `finn-announcements` | every 15 min, 09:00–22:59, Mon–Fri | Pull the market-wide NSE announcements window, dedup by exchange sequence id, classify, write to the brain, push what's material |
| `finn-announcements-weekend` | every 15 min, Sat–Sun | Same job; companies file on weekends too |
| `finn-eod` | 18:30, Mon–Fri | Load the day's NSE bhavcopy, check every holding against the investor's thresholds (volume ×N of 20-day average, price ±X%), push breaches, and explain them from same-day filings |
| `finn-ingest` | every 15 min | Read queued filing PDFs into the brains (no agent turn at all) |
| Investor-created jobs | any | "Every weekday at 8:30, brief me on my IT stocks" in chat creates a real Hermes cron; its answer arrives as a push and a chat message |

**Script-gated wake-ups.** Each job runs a Python pre-script first (`hermes/scripts/finn_*.py`). The script does the fetching, diffing and rule work, then prints a wake gate as its last line (`{"wakeAgent": false}` or the items that need judgment). The LLM only runs when there is something new that a rule can't settle. Most ticks cost nothing. Scripts fail closed, so a broken fetch never wakes the agent into a confused turn.

**When the agent wakes,** it runs with a pinned skill (`finn-enrich`) and a narrow toolset (`finn`, `file`, `web`, `skills`). For each item it writes a ≤160-character "what changed and the number that matters", and a sourced web bio for incoming executives. It writes the result back with `finn_enrich`, then stops.

## Materiality: rules → Jev → LLM

About 4,400 filings a week cross the market. FINN decides which few matter in three stages, each cheaper than the one after it:

1. **Rules.** NSE's own category (`desc`) is mapped to a taxonomy: results, management change, M&A, rating, order win, litigation, routine. Rules settle most filings for free.
2. **Jev (TypeSafe).** Each remaining filing gets six atomic yes/no judgments ("Nouls"): `incident`, `third_party_action`, `core_business`, `stops_activity`, `claims_immaterial` and `routine`. Boilerplate is stripped in code first, and the six are combined into a score in code. About $0.00005 per filing.
3. **LLM, uncertain band only.** Fireworks GLM-5.3-Flash with low reasoning effort decides only the filings Jev's score leaves in the middle, returning importance, direction and a one-liner.

Price is a second signal. A move past thresholds pulls in the filings around it, so a cluster becomes one **developing situation** with a timeline instead of five alerts.

**Proof on real data:** eMudhra, 21–28 Oct 2026, was a browser root-CA distrust, then an exit from the TLS business, then −37% over four sessions. FINN pushed at **10:57 IST** on the first filing, before the lower circuit. Rules alone and Jev alone both under-rated it, because the press release was worded calmly. The cascade caught it.

## Data sources and APIs

| Source | Used for | Notes |
|---|---|---|
| NSE `corporate-announcements` | Every filing, market-wide window per tick, per-company history | Browser-session client with cookie warm-up; history back to 2004, documents from May 2010 |
| NSE XBRL results filings | Results cards | Exact Revenue, EBITDA (derived), PBT, PAT, QoQ and YoY; banks get NII and PPOP. No OCR, no LLM |
| NSE bhavcopy (`BhavCopy_NSE_CM_*.csv.zip`) | Prices, volume, sparklines, EOD thresholds | One official file per day covers every stock |
| Screener documents index → BSE `AnnPdfOpen` / company IR | Annual reports and concall transcripts | Older years fetched on demand |
| Exa (`web_search`, `web_extract`) | Executive bios, sales and press releases, investor decks not on NSE | Primary PDFs found on the web are ingested and cited like filings |
| Fireworks | Chat agent: DeepSeek-V4.1-Flash. Bulk reading: GLM-5.3-Flash. Dossier reasoning: Kimi-K3 | All through the OpenAI-compatible API |
| TypeSafe Jev | Materiality Nouls, document triage | Cheapest model stage |
| Datalab Chandra | OCR for scanned or table-heavy PDFs only | Opt-in per document; the text layer is used whenever it exists |
| Firebase Cloud Messaging (HTTP v1) | Push | Sender key lives only on the server |

## Parsing: PDF → brain page

`ingest.py` turns any filing, transcript or annual report into a markdown page in the company's brain:

1. **Triage.** Jev classifies the document type and decides parse / store / skip, so routine notices don't waste work.
2. **Text extraction.** pypdf reads the text layer, keeping `## Page N` headings so every later citation can point at a page. Chandra OCR runs only when the text layer is missing and the document matters.
3. **Placement.** The document is dated from the NSE filename, not the crawl time. It goes in its folder (`transcripts/`, `annual-reports/`, `filings/docs/`) and is linked from the brain's `index.md` and `log.md`.
4. **Outline (dossiers only).** PageIndex builds a section tree of an annual report with no LLM. It is opt-in, because a 600-page tree costs ~400 MB on a 1 GB worker.

Every document is a row in SQLite (sha256, pages, engine, cost, status), so ingest is idempotent and re-runnable. `finn-ingest` drains the queue every 15 minutes.

## The brain and FTS search

Each company has a brain at `kb/companies/{SYMBOL}/wiki/`:
- `index.md`
- `profile.md`
- `results/` (one page per quarter from XBRL)
- `filings/`
- `transcripts/`
- `annual-reports/`
- `guidance-ledger.md`
- `people/`
- `dossier/`
- `log.md`

These are plain markdown files, so a human, the agent and the app all read the same thing.

Search is **SQLite FTS5**:
- **Chunking:** pages are split at headings and indexed with the `porter unicode61` tokenizer.
- **Ranking:** `bm25` with weights favouring titles and headings. Results return `snippet()` passages.
- **Indexes:** one index per brain, rebuilt when a page changes and warmed at API start. A cross-brain endpoint answers "which of my companies mention data centres" in one call.
- **Speed:** a hit 600 pages into an annual report comes back in milliseconds, and the app opens the page at that section.

There are no embeddings or vector store. Financial questions are mostly about named things (order book, attrition, EBITDA margin), which lexical search with stemming answers exactly and explainably.

## The agent: SOUL, skills and tools

**`SOUL.md`** sets the voice and the rules. It is dense and specific, with units and periods. FINN describes and never advises: no buy/sell, no price targets. Facts are found in a fixed **lookup order**:

1. the brain (`finn_brain_search`)
2. exchange filings (`finn_filings` → `finn_ingest`)
3. the web via Exa
4. "I don't know"

It never searches the filesystem for facts, and every claim carries a tap-to-source citation (`[[TCS:transcripts/2026-10-concall#Page 14|Q2 call p14]]`). It also has speed rules: 2–4 tool calls per answer, and no narration between them.

**Skills:**
- `finn`: the tool catalogue and the answer-block formats
- `finn-enrich`: the cron-time enrichment contract

**FINN's tools** are a Hermes plugin (`hermes/plugins/finn`) wrapping the FINN API:

| Tool | Purpose |
|---|---|
| `finn_portfolio` | Live holdings, weights and thresholds (picks up additions mid-chat) |
| `finn_brain_search` | FTS5 search across one or all brains |
| `finn_results` | Latest quarter from XBRL |
| `finn_digest` | Ranked digest for the last N hours |
| `finn_filings` | NSE filings for any date range, years back |
| `finn_filing_text` | Text of a filing PDF without ingesting it |
| `finn_ingest` | Read filing PDFs into the brain now |
| `finn_fetch_reports` | Older annual reports and transcripts |
| `finn_dossier` | The grounded research dossier |
| `finn_onboard` | Add holdings and scaffold their brains |
| `finn_enrich` | Write a one-liner or bio back to a feed item |

The agent also has Hermes's built-in tools: web (Exa), cron (scheduling), memory, files, vision and skills.

**Runtime settings:**
- Up to 4 concurrent sessions, so several chats run at once.
- Approvals are off for the app, and `protect-identity` stops the agent editing its own SOUL, config or keys.
- Hermes's background self-review nudges are disabled to keep turns fast.

## The dossier: promised vs delivered

`finn_dossier` builds research from primary sources only: the last four concall transcripts, the latest annual report and XBRL results.

- **Guidance ledger.** The cheap model extracts every forward-looking statement, quoted verbatim with its page.
- **Audit.** Kimi-K3 checks each promise against the filed numbers *and* what management said on the next call, and marks it delivered, partly, missed or too early.
  - TCS Q1 FY27, "Manufacturing expected to turn around in Q2" → Q2 call: "grew 3.1% QoQ CC" → **delivered**.
  - "Margins toward the 26–28% band" → operating margin 24.0% → **missed**.
- **Delivery.** It runs on demand for any NSE symbol, with a progress bar in the app and a push when it finishes.

## The app

- **Stack:** Expo (React Native) with expo-router and three tabs (Brief, Watch, Ask). It is a native Android build.
- **Brief:** a ranked count ("your companies filed 77 times; 11 are worth your time"), a stacked deck of what needs you, and filters for every section.
- **Ask:** streams the agent's answer with a live **tool trace**. The `finn_app` adapter maps Hermes events (tool progress, streamed edits, finalize, reactions, slash-confirm, media) to app messages. It also supports quoted replies, reactions, voice in and out, several chats at once, and a push when a background chat finishes.
- **Generative UI.** FINN answers in fenced JSON blocks that the app renders natively and makes tappable:
  - **Static blocks:** `finn-chart` (bar, line, area, donut, scatter), `finn-table` (sortable), `finn-cards`, `finn-timeline`, `finn-form`, `finn-actions`.
  - **Live blocks:** `finn-price`, `finn-results`, `finn-holdings`, `finn-story` and `finn-source` fetch their numbers from FINN's API, so the model never types a figure.
  - **`finn-scenario`:** a what-if with sliders, recomputed in the app by a small safe expression evaluator.
- **Brain screen:** the folder tree, FTS search and page reader for each company.
- **Auth:**
  - One password, checked against an scrypt hash on the server, which then issues a 30-day JWT carrying the password version. The app keeps it in Android secure storage.
  - Changing the password revokes every session. Logins are throttled per client.
  - No key ships in the APK, and the release script refuses to build one that contains a token.
- **Design ("Bombay Deco"):**
  - **Typefaces:** Josefin Sans caps for the wordmark, titles and tickers; Public Sans with tabular figures for numbers.
  - **Colours:** a sea-green shell on a stone ground. Brass appears only when FINN is acting, red only for losses.
  - **Setback rank marks:** importance drawn as the stepped silhouettes of Marine Drive's Art Deco buildings.
  - **The system is written down** in `DESIGN.md`.

## Infrastructure

- **Two OCI VMs:**
  - **Edge (public):** Caddy terminates HTTPS and proxies `/api` to the worker.
  - **Worker (private):** runs the FINN API (FastAPI, SQLite) and the Hermes gateway with its crons, as systemd services.
- **Deploys** (`deploy/oci.sh`) ship code only. The worker owns its data (`kb/`, `data/`), so a deploy never rolls back what the crons have read.
- **Releases** are versioned (`scripts/release.sh`): version bump, APK build, guards, covering-note PDF, git tag and GitHub release.

## Cost (development and live running, from FINN's own ledger)

| What | Calls | Spend |
|---|---|---|
| Jev triage and materiality | 325 | **$0.021** |
| Chandra OCR | 19 documents | **$1.91** |
| Fireworks LLMs | ~240 | ~1.4M input / 0.4M output tokens |

Cost stays this low for three reasons:
- Rules come before models.
- Crons are script-gated.
- Numbers come from XBRL instead of OCR. Cheap models do the reading and the strong model only does the two reasoning steps per dossier.

## How it was built

It was built with Claude Code, in one long session included as the AI build history (`docs/build-history/`). It reuses the pieces of FieldClaw, our construction-site agent on Hermes: a construction site became a company, keeping the same per-entity markdown brain, PDF ingest, script-gated crons and gateway adapter.

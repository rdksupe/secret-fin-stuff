# FINN — covering note

**Try it:** install the Android app (link in the README). It talks to a live backend on Oracle Cloud that has been reading NSE since 30 October. Nothing is mocked: every filing, price and result you see is real NSE data for a mock 18-company portfolio.

## The point of view

The brief says the scarce skill is filtering, not aggregating. FINN takes that literally. The first line of the app is a count: *"FINN read 917 exchange filings in the last day. 5 were from your companies; 2 are worth your time."* Everything below that line is the 2, ranked, with the rest folded away.

FINN is an agent you talk to rather than a dashboard you read. It is a real always-on agent (Hermes) with its own memory, tools and scheduled jobs. The app is one of its messaging channels, the same way Telegram is. So "watch Maruti's margins and tell me every Monday" in the app creates a real scheduled job, and its answer comes back as a push notification.

## What it does

**Push (what changed, ranked):**
- **Results cards:** Revenue, EBITDA, PBT and PAT, each QoQ and YoY, read from NSE's XBRL filing. They are exact, use no OCR or LLM, and link to the filing. Banks get NII and PPOP instead. Red flags are raised when other income or one-off items drive profit (DIXON: other income was 61% of PBT).
- **Management changes:** a bio of the incoming person, from a web search with sources. HDFC Bank's new MD & CEO arrived with his ICICI history.
- **Every other filing:** a one-line "what changed and why it matters", or folded away as routine.
- **Unusual moves:** your own thresholds (volume ×N, price ±X%), checked against NSE's daily bhavcopy.
- **"Developing situations":** a price move pulls in the filings around it, so you see one story instead of five alerts.
- **Replay test, eMudhra, 21–28 Oct 2026:** a browser root-CA distrust, then an exit from the TLS business, then −37% over four sessions. FINN pushed at **10:57 IST** on the first filing, before the lower circuit. A rules-only system (and our own first cut) would have missed it.

**Pull (research grounded in primary sources only):**
- **Sources:** the company's own last four concall transcripts and latest annual report (from screener links to BSE and company IR), plus NSE results. No news, broker notes or model memory.
- **Dossier sections:** business snapshot, quarterly trajectory, a **guidance ledger** (each promise quoted verbatim with its page), a **promised-vs-delivered audit**, and bull/bear.
- **How the audit checks promises:** against the filed numbers *and* what management reported on the next call. For example, TCS on Q1 FY27: "Manufacturing expected to turn around in Q2" → Q2 call: "Manufacturing grew 3.1% QoQ CC" → **delivered**. And "margins toward the 26–28% band" → operating margin fell to 24.0% → **missed**.
- **Coverage:** works for any NSE symbol (it builds the dossier on demand). Built for 16 of the 18 portfolio companies.

**Talk to it:**
- Chat streams answers with citations, and shows each tool step as it runs.
- **Answers you can touch:** FINN replies with native charts (tap a bar to read it, toggle series), sortable tables, company cards that open the company, and follow-up buttons. It can also send images and files it makes.
- **It goes back in time on its own:** "compare with October 2019" makes FINN fetch that period's NSE filings, read them into the company's brain, and answer from them, with no scraping.
- **Several chats at once:** each chat is its own agent session. One that finishes while you're elsewhere sends a push.
- Voice: speak a question and listen to the answer. Long-press any message to reply to it or react.
- Ask about any story, and the context comes along.
- Behaves like a messaging bot: send several messages in a burst, add to a running answer, or `/stop` it.

**Browse what it knows:** every company has a brain screen. It shows the folders (dossier, results, transcripts, annual reports with page trees, filings) and has full-text search across all of it. A hit opens at the matching page, even 600 pages into an annual report.

## Design

The app's look is taken from the street its investor works on: the 1930s Art Deco of Marine Drive and the Fort, Mumbai's money district.
- **Colours:** a sea-green shell, a stone ground and lacquer ink. Brass appears only when FINN itself is acting, red only for losses.
- **The signature move:** importance is drawn as setbacks, the stepped silhouettes of those buildings. A 1–3 tier mark ranks every story, and what needs you comes as a deck of stepped sea-green cards you flick through.
- **The rest is standard Android:** Material navigation, system Back, and 48 dp touch targets.

## Judgment calls

- **Rules → Jev → LLM cascade for "is this material?"**
  - Rules settle most of the market's ~4,400 weekly filings for free.
  - TypeSafe's **Jev** answers six atomic yes/no questions about each remaining filing, for about $0.00005 each.
  - Only Jev's *uncertain* band reaches an LLM.
  - We tested this against the alternatives on real filings. Jev alone underrated eMudhra (its press release was worded calmly), and LLMs alone are slower and pricier on routine filings. The cascade got both right.
- **XBRL instead of OCR for numbers.** Results come from the exchange's machine-readable filing, so the headline numbers on the card are exact.
- **Cheap models read, strong models reason.**
  - GLM-5.3-Flash with low reasoning effort does the bulk reading (extraction, one-liners). Without the effort cap it spent its whole budget thinking and returned nothing.
  - Kimi-K3 handles only the two reasoning steps per dossier (promised vs delivered, bull/bear).
  - Chandra OCR is used only where tables matter (decks, results PDFs). PageIndex builds annual-report trees with no LLM.
- **Every LLM-written number is cited, but not yet verified.** One-liners cite their filing; dossier rows cite their transcript page or quarter; results cards are exact. A deterministic checker that matched figures against their sources only caught 34 of 60 fabricated figures in our own adversarial test, so we didn't ship it as a trust signal (see below).

## Cost so far (all development and live running, from FINN's own ledger)

| What | Calls | Spend |
|---|---|---|
| Jev triage and materiality | 325 | **$0.021** |
| Chandra OCR | 19 documents | **$1.91** |
| Fireworks LLMs (GLM-5.3-Flash, Kimi-K3) | ~240 | ~1.4M input / 0.4M output tokens |

Most cron runs cost nothing: a script does the fetching and diffing, and the agent only wakes when something new needs judgment.

## What is not done, or is weak

- **Number verification.** The deterministic checker isn't good enough (34/60 fabricated figures caught), so citations are shown but figures are not independently verified. The right design is per-claim checking against the *specific* cited page; it isn't built yet.
- **Gaps in the research data:**
  - ITC holds no earnings calls, so its dossier has no promised-vs-delivered section.
  - A few transcripts failed because BSE served a web page instead of the PDF; MARUTI has only one transcript, so its audit is thin.
  - Balance-sheet and cash-flow analysis isn't built. We have the annual reports but haven't extracted the statements.
- **Single investor.** One portfolio and one set of thresholds. Each install keeps its own chats, but the portfolio is shared.
- **Android only.** There is no iOS build. The app token expires on 30 November 2026.
- **Not finished:**
  - A market-labelled classifier: 6 months of filings (25k) labelled by abnormal price reaction, results-day confounds removed. It is collected and partly featurised, but not trained.
  - An entity graph across companies and people.

## How it was built

Claude Code, in one long session that is included as the AI build history (`docs/build-history/`). It started from our hackathon project (FieldClaw, a construction-site agent on Hermes) and reused its pieces. A construction site became a company: the same per-entity markdown "brain", PDF ingest, script-gated crons and Hermes runtime.

# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

## Users

**Primary: professional investors.** Fund managers and analysts at firms like ENAM who already read filings and concall transcripts for a living. They want triage and grounded research, not explanations of basics.

**Also: serious individual investors.** Self-directed HNI and active retail investors managing their own NSE portfolio: financially literate, but not full-time analysts. FINN is built to the professional's standard and stays usable for this reader without hand-holding.

The working scene: one person, one NSE portfolio (the reference portfolio is 19 names with weights), checking a phone between other work. That means short sessions, a push notification as the usual way in, and attention measured in seconds.

## Product Purpose

FINN is an always-on investor agent for an NSE portfolio. It watches every exchange filing and price move, decides what matters to this investor, and answers questions from each company's own documents.

Success means the investor learns what changed in their companies without wading through the feed. When they ask "why?" or "did management deliver?", the answer is grounded and cited, and fast enough to use on a phone.

## Positioning

**An agent, not a dashboard.** FINN is something you talk to, and it works when you're not looking:
- it runs the scheduled watches you ask for ("every weekday at 8:30…") and notifies you
- it takes questions by text or voice, and you can quote a message and add to a running answer
- it works on several chats at once
- it builds a company's research brain on demand and tells you when it's ready

The app is one messaging channel into that agent, the same way Telegram is, not a set of screens over a database. This is the claim to protect: other products show feeds and charts; FINN acts.

## Operating Context

- **Push:**
  - Crons poll NSE announcements every 15 minutes in market hours, plus the end-of-day bhavcopy.
  - A materiality cascade decides what is pushed: rules, then TypeSafe Jev, then an LLM on the uncertain band. Push notifications go out over FCM.
- **Brief:** a windowed, ranked digest. A lead story first, then results cards, management changes with bios, and "developing situations" that merge a price move with its filings. Routine filings are folded away.
- **Company brains:** per-company markdown under `kb/companies/{SYMBOL}/wiki/`:
  - dossier, results, call transcripts, annual reports (with PageIndex trees), filings, people, news
  - full-text searchable, and linked with `[[wikilinks]]`
- **Dossier:** snapshot, quarterly trajectory, guidance ledger, promised-vs-delivered audit, and bull/bear.
- **Ask:** the Hermes agent through the `finn_app` platform plugin:
  - streamed answers that show tool steps
  - quoted replies and reactions
  - several sessions at once
  - voice input (smallest.ai speech-to-text) and spoken answers (text-to-speech)
  - scheduled jobs whose results arrive as notifications
- **Data sources:**
  - NSE corporate announcements, integrated-filing XBRL and bhavcopy
  - annual-report and transcript links via screener.in, hosted on BSE and company IR sites
  - Exa search, only for background on executives

## Capabilities and Constraints

- **No buy/sell advice.** No price targets, ratings or recommendations anywhere in the UI, copy or agent output. FINN describes; the investor decides.
- **Never invent numbers.**
  - Every figure shown is either exact (from XBRL) or cited to its source page.
  - No illustrative or placeholder data anywhere, onboarding and empty states included.
  - Where the source is silent, say so.
- **Android only for now.** A native Expo (React Native) app with no iOS build. There is no public web app: the API is behind JWT auth, and the token is baked into the build.
- **Primary sources only for research.** No news, broker notes or model memory in pull answers. News is push-side context only.
- **Single investor.** One portfolio and one set of thresholds per deployment; each install gets its own chats.
- **Not yet built or verified:**
  - Per-claim number verification: citations are shown, but figures aren't independently checked.
  - Balance-sheet and cash-flow extraction.
  - A market-labelled materiality classifier.
  - An entity graph.
- **Terminology:**
  - **brain:** a company's markdown knowledge base
  - **dossier:** FINN's research summary for one company
  - **Brief:** the ranked digest
  - **promised vs delivered:** the guidance audit
  - **developing situation:** a price move merged with the filings around it

## Brand Commitments

- **Name:** FINN.
- **Voice:**
  - Dense and specific: numbers with units (₹ Cr, %, bps) and the period they cover.
  - Lead with the answer, then the evidence. No preamble.
  - Say what isn't known ("the transcripts don't say" is a complete answer).
  - Never hype.

## Evidence on Hand

- **Live data:** real NSE data for the reference portfolio, collected since 30 Oct 2026. Nothing is mocked.
- **eMudhra replay (21–28 Oct 2026):** FINN pushed at 10:57 IST on the first filing, before the lower circuit; the stock then fell 37% over four sessions.
- **TCS promised-vs-delivered audit:** across four calls, for example "manufacturing turnaround" was delivered and "margins toward 26–28%" was missed.
- **Results flags:** for example, DIXON's other income was 61% of profit before tax.
- **Cost ledger** (from `docs/COVERING_NOTE.md`): Jev about $0.02 over 325 calls, Chandra OCR about $1.91 over 19 documents.
- **Build history:** `docs/build-history/`.
- **Must not be fabricated:** there are no users, testimonials, customers, press, pricing or deployment claims.

## Product Principles

1. **Act, don't display.** Every surface should lead to something FINN does or can be asked to do: watch, explain, research, notify. A screen that only shows data is unfinished.
2. **Filter ruthlessly.** The scarce thing is the investor's attention. Rank, fold the routine away, and push only when it matters.
3. **Ground every claim.** An answer is only as good as its citation. Exact numbers or a page reference, or an honest "not in the sources".
4. **Speed is part of correctness.** A grounded answer that arrives too late for a phone session has failed. Fewer steps beat more thoroughness nobody waited for.
5. **Professional standard, plain language.** Assume a reader who knows what PBT and promised-vs-delivered mean, and never pad for one who doesn't.

## Accessibility & Inclusion

The incumbent build targets WCAG AA contrast on its dark palette and keeps text at 12px or larger. Voice input and output are first-class, for use away from a keyboard. No further product-specific requirement has been established.

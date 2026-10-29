---
name: finn
description: FINN investor agent — per-company brains under kb/companies/{SYMBOL}, the `finn` CLI for portfolio/digest/results, and how to answer investor questions from primary sources only.
version: 0.1.0
---

# FINN

`FINN_REPO` is the repo root (see `.env`). Everything below runs from there.

## FINN tools (native — prefer these over the shell)

| Tool | Use |
|---|---|
| `finn_digest(hours)` | Ranked digest for a window: `alert`, `brief`, `list`, collapsed `routine` |
| `finn_results(symbol)` | Latest quarter vs prev quarter vs year ago, from NSE XBRL, with red flags |
| `finn_onboard(symbols, weights?)` | Add holdings / create a brain: scaffold, backfill 30 days of filings + results |
| `finn_filing_text(url)` | Text of an exchange filing PDF |
| `finn_enrich(feed_id, summary, …)` | Write enrichment back to a feed item (see `finn-enrich`) |

## Company brains

`$FINN_REPO/kb/companies/{SYMBOL}/wiki/` — read `index.md` first, then follow links.
Use `ls`, `rg`, `cat` (or `read_file`). Never embed or vector-search; walk the files.

Questions and where to look:

| Question | Read |
|---|---|
| "How were the numbers?" | `results/` (newest file first) |
| "What did they file this week?" | `filings/{YYYY-MM}.md` |
| "Who is the new CFO?" | `people/` |
| "What did management promise?" | `guidance-ledger.md`, then `transcripts/` |
| Business mix, segments, debt, cash flow | `annual-reports/` |

If the needed folder is empty, say so and run `finn-research` for that symbol rather
than answering from memory.

## Answer shape (chat)
- Mobile screen: ≤ 8 lines unless asked for depth. Tables for numbers.
- Every number carries its period and source file.
- End with at most one useful follow-up offer, not a list.

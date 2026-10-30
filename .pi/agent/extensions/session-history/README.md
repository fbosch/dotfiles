# Session history

Lets an agent find which prior Pi session handled something and read verified details from it without resuming the session. The spec lives in `openspec/changes/add-pi-session-history/`.

## Tools

Both tools use `deferred` exposure. They load through `tool_search` and are not part of `defaultTools`.

- `history_search` runs a full-text search across every project. Ranking combines BM25 relevance with boosts for recent sessions and the current project (same directory, ancestor, or descendant). The current session is excluded; context-masking `recall` covers it. Each result gives the title, date, project, session ID, best-matching message ID, and a snippet. Queries drop English and Danish stop words, and a camelCase or snake_case query word also matches its split parts. When no session matches every term, the tool retries requiring at least two terms (one for two-term queries) and says so.
- `history_read` returns verbatim, bounded content from one session:
  - `question`: full-text search picks up to 40 candidate chunks. One classifier request over 500-character previews (at most 24 KB) keeps up to 8. If the classifier is disabled or fails, the tool returns the top 8 full-text chunks and labels the fallback.
  - `around`: messages around a message ID, 5 on each side by default and at most 20.
  - Neither: the session header and the start of the session.

Output is capped at 12 KB of excerpts plus a header of up to 1 KB. Each excerpt cites its message ID. All output is marked as historical data, not instructions. Limits live in `SEARCH_LIMITS` (`search.ts`) and `READ_LIMITS` (`read.ts`).

## Index

- Location: `session-history/index.db` under Pi's agent directory (`.pi/agent/` in this repo, ignored by `.pi/agent/.gitignore`). The directory is `0700` and the database `0600`.
- Contents: user and assistant text, compaction and branch summaries, and tool-call names and arguments (first 2,000 characters). Tool results, thinking, images, and subagent sessions (`<session>/tasks/*.jsonl`) are not indexed.
- Identifier parts: FTS5 keeps `createBrowserRouter` as one token, so a `terms` column also indexes `create browser router`. BM25 weights `terms` at 0.4, so whole-token matches rank first.
- Updates: `session_start` starts a detached reconciliation that indexes added or changed files, appending when a file only grew, and drops deleted ones. `agent_end` and `session_shutdown` append the current session. Nothing polls.
- Concurrency: SQLite WAL mode with `BEGIN IMMEDIATE` transactions. A writer that finds another process already advanced a file skips it rather than duplicating chunks.
- Format: bump `INDEX_FORMAT_VERSION` in `store.ts` when parsing or schema changes. The next open rebuilds the index.

On this machine, 483 sessions (1.6 GB of JSONL) index in about 7 s into an 83 MB database. An unchanged reconcile takes about 30 ms and searches take under 10 ms.

## Modules

- `store.ts`: the history index. It owns the SQLite schema, every SQL statement, FTS5 expression building (`fts-query.ts`), and BM25 column weights. Callers query by free text, session, and message; none see SQL.
- `indexer.ts`: reads session JSONL from the stored byte offset, parses and chunks entries at word boundaries, and writes them through the store. Its interface is `syncFile` and `reconcile`.
- `lifecycle.ts`: `HistoryIndex` serializes index work in one queue, reports `updating` and `failure` through `status()`, and aborts reconciliation on shutdown.
- `search.ts` and `read.ts`: ranking and the three read modes over the store's interface.
- `index.ts`: maps Pi events and tool calls onto those modules.

Tests exercise these interfaces against real SQLite in temporary directories.

## Rebuild

1. Quit or `/reload` every running Pi session.
2. Delete the index: `rm -rf .pi/agent/session-history`.
3. Start Pi. The first `session_start` rebuilds the index in the background.

## Shared lexical rules

`.pi/agent/lib/lexical.ts` holds the stop words and identifier splitting shared with context-masking `recall`. The BM25 engines stay separate: `recall` scores a few in-memory archives per call, while this index needs persistent FTS5.

## Runtime note

Pi 1.4.0 runs on Node 22, where importing `node:sqlite` prints an ExperimentalWarning. `sqlite.ts` filters only that warning during the import so it doesn't corrupt the TUI. Remove the filter once Pi runs on Node 24.

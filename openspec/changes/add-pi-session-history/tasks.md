# Tasks

## 1. Index storage and parsing

- [x] 1.1 Confirm Pi's installed runtime exposes built-in SQLite with FTS5 by loading a probe extension under `/reload`; verification: the probe creates an FTS5 table, or the change stops for a storage decision.
- [x] 1.2 Scaffold `.pi/agent/extensions/session-history/` and add `/session-history/` to `.pi/agent/.gitignore`; verification: `git check-ignore .pi/agent/session-history/index.db` succeeds.
- [x] 1.3 Parse session JSONL into message chunks with session and message IDs, including user and assistant text, compaction summaries, tool calls and file paths, and excluding tool results, thinking, images, and subagent sessions; verification: `__tests__/` fixture tests cover each included and excluded type and long-message splitting.
- [x] 1.4 Create the owner-only FTS5 index with an index-format version, WAL mode, and a busy timeout; verification: tests cover schema creation, version-mismatch rebuild, and concurrent writers.

## 2. Event updates and startup reconciliation

- [x] 2.1 Reconcile added, changed, and deleted session files after `session_start` without blocking it; verification: tests cover each file change and show that `session_start` completes before reconciliation.
- [x] 2.2 Index completed entries from Pi session events and register no timers; verification: tests show a completed turn becomes searchable and that an idle session schedules no work.
- [x] 2.3 Prove indexing never modifies session files; verification: a test compares session file contents and modification times before and after indexing.

## 3. `history_search`

- [x] 3.1 Register `history_search` as a deferred tool absent from `defaultTools`; verification: tests show it is inactive at startup and discoverable through tool search.
- [x] 3.2 Implement BM25 search across projects with recency and current-project boosts behind one ranking function, excluding the calling session; verification: tests cover cross-project matches, project tie-breaking, and calling-session exclusion.
- [x] 3.3 Return bounded results with title, date, project, session ID, and snippet, and report `index updating` during reconciliation; verification: tests cover result shape, the result limit, the empty result, and the updating state.

## 4. `history_read`

- [x] 4.1 Register deferred `history_read` with `around` windows (default ±5, maximum ±20), start reads, and unknown-ID errors; verification: tests cover the default, clamping, start reads, and errors.
- [x] 4.2 Implement question reads: up to 40 FTS5 candidates, one classifier request over previews of about 500 bytes (about 20 KB), up to 8 verbatim excerpts within 12 KB plus a 1 KB header, and a labeled BM25 fallback; verification: tests with a stub classifier cover selection, request count, budgets, and fallback for disabled, failed, timed-out, and invalid output.
- [ ] 4.3 Tune budgets against 10–20 real "which session did we address X" questions from local history; verification: record hit rate and budget changes in the extension README.

## 5. Integration

- [x] 5.1 Document the tools, settings, index location, rebuild procedure, and the boundary with context-masking `recall` in the extension README; verification: the README's rebuild steps work as written.
- [ ] 5.2 Run `devenv test` and a live `/reload` session that finds a known prior session through `history_search` and verifies it through `history_read`; verification: tests pass and the live session returns the expected session ID.

## Context

See proposal.md for motivation and specs/pi-session-history/spec.md for requirements. Pi stores sessions as JSONL files under `~/.pi/agent/sessions/`. Context-masking `recall` already selects classifier-cited passages for the current branch through `.pi/agent/lib/classifier.ts`. This change reuses that classifier path for prior sessions and adds no answering model.

Pi runs with `PI_CODING_AGENT_DIR` set to the repository's `.pi/agent/`, so the index directory lives inside the dotfiles worktree. The `/session-history/` entry in `.pi/agent/.gitignore` is therefore required, like the existing `/sessions/` entry.

## Goals / Non-Goals

**Goals:**

- Answer "which session addressed X?" with one search call and verify details with one read call.
- Keep tool output bounded and verbatim so the calling agent remains the only answering model.
- Keep the index rebuildable. Deleting it loses no data.

**Non-Goals:**

- No semantic or embedding search, no classifier reranking in `history_search`, no human picker or session jump, no startup primer.
- No search over the calling session, which remains `recall`'s responsibility.

## Decisions

### FTS5 in the runtime's built-in SQLite

The index uses one SQLite database with an FTS5 table and BM25 ranking. Ranking adds bounded recency and current-project boosts. Search goes through one ranking function, so classifier reranking or embeddings can be added later without changing tool contracts.

Alternatives: scanning JSONL on each search avoids state but grows linearly with history. Embeddings improve paraphrase recall but add a provider and send session text off the machine. A dependency-backed database conflicts with the no-new-dependency constraint. Pi 1.4.0 runs on Node 22.23.4, whose `node:sqlite` includes FTS5. Importing it on Node 22 emits an ExperimentalWarning that would corrupt the fullscreen TUI, so the loader filters only that warning during the import.

### Events plus startup reconciliation, no polling

While Pi runs, the extension indexes completed session entries from Pi session events. At startup it compares each session file's size and modification time with stored state, then reindexes added or changed files and removes deleted ones. Other Pi processes update the index through their own events, so concurrent sessions stay current without polling.

Alternative: interval re-sync, as in `pi-session-search`, is simpler but conflicts with the repository's event-driven preference.

Reconciliation runs after `session_start` returns and yields between files. SQLite write-ahead logging with a busy timeout keeps concurrent Pi processes from corrupting or blocking each other.

### Shared query rules, separate BM25 engines

Query preparation reuses `.pi/agent/lib/lexical.ts`, shared with context-masking `recall`: English and Danish stop words and camelCase or snake_case splitting. FTS5's `unicode61` tokenizer keeps `createBrowserRouter` whole, so an extra `terms` column indexes identifier parts with a lower BM25 weight (0.4), mirroring recall's whole-identifier bonus. When no session matches every term, search retries requiring two terms, or one for two-term queries. The BM25 engines stay separate: recall scores small in-memory archives per call, and sharing an engine would force an in-memory index over the whole history or a database for recall's transient data.

### One chunk per message

Each indexed message becomes one chunk tagged with its session ID and message ID. Messages longer than about 1,500 bytes split into overlapping parts with the same message ID. Citations therefore always map to a message that `history_read` can open.

### Classifier selects, the calling agent answers

A question read runs in three steps:

1. FTS5 picks up to 40 candidate chunks from the session.
2. The classifier receives about 500-byte previews of each candidate, about 20 KB per request, and returns the IDs to keep, up to 8.
3. The tool returns the full text of the selected chunks verbatim within 12 KB, plus a session header of at most 1 KB.

Previews keep classification to one request under the 28 KB limit used elsewhere. The fallback returns the top 8 BM25 chunks labeled `classifier unavailable`. The defaults are constants in one place (`READ_LIMITS`) and are tuned against real questions in task 4.3.

Alternative: an answering model such as Luna fast produces shorter output, but it adds a request and can invent details. The calling agent is already an LLM, so verbatim excerpts suffice.

### Separate from context-masking recall

The tools use the `history_` prefix and exclude the calling session. `recall` keeps the current branch, including tool output and images. The two share only the classifier library.

## Risks / Trade-offs

- [A Pi upgrade changes the Node runtime] → Node 24 ships stable `node:sqlite`; remove the warning filter then. Tests run under Bun, so verify `node:sqlite` behavior on the runtime Pi actually uses after upgrades.
- [Pi exits before an event write completes] → Startup reconciliation detects the file change and reindexes that session.
- [The first full index is slow on a large history] → Reconciliation doesn't block startup, and searches report `index updating`.
- [Excerpts consume caller context] → Hard 12 KB cap. Lower it if context pressure appears.
- [Indexed tool arguments contain secrets] → The index stays in an owner-only local directory outside Git and excludes tool results. Tool arguments remain searchable by design.
- [The session JSONL format changes] → Unknown entry types are skipped. A stored index-format version triggers a full rebuild when the parser changes.

## Migration Plan

Install by adding the extension and running `/reload`. The first startup builds the index. Roll back by removing the extension and deleting `session-history/` under Pi's agent directory. No session file changes.

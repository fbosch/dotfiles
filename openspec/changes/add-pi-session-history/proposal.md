## Why

An agent can't answer "which session did we address X in?" without the user resuming old sessions or searching `~/.pi/agent/sessions/` by hand. The context-masking `recall` tool searches only the current session branch, so prior sessions in every project stay out of reach.

## What Changes

- Add a `session-history` extension that keeps a local full-text index of prior Pi sessions in every project.
- Add a deferred `history_search` tool. It returns ranked session matches, each with title, date, project, session ID, and a short snippet.
- Add a deferred `history_read` tool. It returns bounded, verbatim content from one session: classifier-selected excerpts for a question, a window around a message, or the session header and start.
- Update the index from Pi session events while Pi runs, and reconcile changed session files at startup. The index doesn't poll.
- Index user and assistant text, compaction summaries, tool calls, and file paths. Exclude tool results, hidden thinking, and subagent sessions.
- Store the index in `session-history/` under Pi's agent directory and keep it out of Git.
- Out of scope: embeddings, a `/find` picker, `/find-back` navigation, a startup primer, an answering model, resume commands, and changed-file lists.

## Capabilities

### New Capabilities

- `pi-session-history`: Defines searching and reading prior Pi sessions through deferred agent tools, backed by a local event-updated index.

### Modified Capabilities

- None. The context-masking `recall` tool keeps its current-branch scope and remains separate.

## Impact

- Affected dotfiles: a new extension under `.pi/agent/extensions/session-history/`, neighboring `__tests__/`, and a `/session-history/` entry in `.pi/agent/.gitignore`.
- Affected interfaces: two new deferred tools. Neither is added to `defaultTools`.
- Shared code: reuses `.pi/agent/lib/classifier.ts` and the configured `settings.classifier.providers`.
- Data: reads Pi session JSONL files without modifying them. Writes a rebuildable index outside the repository. No persisted-data migration is required.
- No new dependency. The index uses the installed runtime's built-in SQLite with FTS5.

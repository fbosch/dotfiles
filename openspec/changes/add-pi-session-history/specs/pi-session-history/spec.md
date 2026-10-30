# Spec Delta

## Purpose

Lets an agent find which prior Pi session addressed a topic and read verified details from that session without resuming it or scanning session files by hand.

## ADDED Requirements

### Requirement: History tools are deferred

The extension SHALL register `history_search` and `history_read` as deferred tools. It MUST NOT add either tool to the startup tool selection, and it SHALL make both discoverable through tool search.

#### Scenario: A new session starts

- **WHEN** Pi starts with the extension installed and default settings
- **THEN** neither history tool is active until tool search loads it

#### Scenario: The agent needs prior-session context

- **WHEN** the agent searches tools for prior-session history
- **THEN** tool search returns `history_search` and `history_read`

### Requirement: Search covers prior sessions across projects

`history_search` SHALL search indexed sessions from every project. It SHALL rank matches by text relevance and boost recent and current-project sessions. It MUST exclude the calling session.

#### Scenario: A match exists in another project

- **WHEN** the agent searches for a term that occurs only in another project's session
- **THEN** the results include that session

#### Scenario: Equal matches in different projects

- **WHEN** two sessions match equally and only one belongs to the current project
- **THEN** the current-project session ranks first

#### Scenario: The calling session contains the term

- **WHEN** the term also occurs in the calling session
- **THEN** the results exclude the calling session

### Requirement: Search results identify sessions compactly

Each `history_search` result SHALL contain the session title, date, project, session ID, and a bounded snippet around the match. The tool SHALL return at most a bounded number of results.

#### Scenario: A search returns results

- **WHEN** a search matches indexed sessions
- **THEN** each result includes title, date, project, session ID, and a snippet within its size limit

#### Scenario: A search matches nothing

- **WHEN** no indexed session matches
- **THEN** the tool returns an empty result that states no sessions matched

### Requirement: Question reads return classifier-selected verbatim excerpts

`history_read` with a session ID and `question` SHALL return verbatim excerpts with message IDs plus a bounded session header. Full-text search SHALL choose candidates. One classifier request SHALL select the excerpts. The tool MUST NOT call an answering model.

#### Scenario: The classifier selects excerpts

- **WHEN** the agent reads a session with a question and the classifier succeeds
- **THEN** the tool returns only selected excerpts, verbatim, each with its message ID, within the excerpt budget

#### Scenario: A question read issues requests

- **WHEN** a question read completes
- **THEN** the extension has sent at most one classifier request per configured provider attempt and no answering-model request

### Requirement: Question reads degrade to full-text ranking

When the classifier is disabled, unavailable, times out, or returns invalid output, a question read SHALL return the top full-text excerpts within the same budget. It SHALL state that classifier selection was unavailable.

#### Scenario: The classifier fails

- **WHEN** the classifier request fails during a question read
- **THEN** the tool returns the top full-text excerpts labeled as unavailable classifier selection

### Requirement: Window and start reads are bounded

`history_read` with `around` SHALL return a symmetric message window around the given message, five on each side by default and at most twenty. Without `question` or `around`, it SHALL return the session header and the session start within the excerpt budget.

#### Scenario: A window is requested

- **WHEN** the agent reads around a message without specifying a size
- **THEN** the tool returns up to five messages before and after that message

#### Scenario: An oversized window is requested

- **WHEN** the agent requests more than twenty messages on each side
- **THEN** the tool limits the window to twenty on each side

#### Scenario: An unknown session or message is requested

- **WHEN** the session ID or message ID doesn't exist in the index
- **THEN** the tool returns an error naming the unknown identifier

### Requirement: The index contains only conversation and tool-call content

The index SHALL contain user and assistant text, compaction summaries, tool-call names and arguments, and file paths. It MUST exclude tool results, hidden thinking, images, and subagent child sessions.

#### Scenario: A session contains excluded content

- **WHEN** a session contains a tool result, thinking text, and an assistant reply
- **THEN** searches can match the assistant reply but not the tool result or thinking text

#### Scenario: A subagent child session exists

- **WHEN** a subagent child session contains a matching term
- **THEN** searches exclude that child session

### Requirement: The index updates from events and startup reconciliation

The extension SHALL index new session content from Pi session events while Pi runs. At startup it SHALL reconcile added, changed, and deleted session files. It MUST NOT poll.

#### Scenario: A turn completes

- **WHEN** a turn completes in a running session
- **THEN** a later session can find that turn's indexed content after the next startup reconciliation or event update

#### Scenario: A session changed while Pi was closed

- **WHEN** a session file is added, changed, or deleted while no Pi process runs
- **THEN** the next startup updates the index to match

#### Scenario: Pi is idle

- **WHEN** Pi is idle with no session events
- **THEN** the extension performs no periodic index work

### Requirement: Indexing doesn't block Pi

Startup reconciliation SHALL NOT delay session start. While reconciliation is incomplete, searches SHALL answer from the existing index and report that the index is still updating.

#### Scenario: A search runs during reconciliation

- **WHEN** the agent searches before startup reconciliation finishes
- **THEN** the tool returns results from the existing index and reports that the index is updating

### Requirement: Session files are read-only and history is data

The extension MUST NOT modify Pi session files. Tool output SHALL mark returned session content as historical data, not instructions.

#### Scenario: Any history operation runs

- **WHEN** indexing, search, or read completes
- **THEN** every session file's contents and modification time are unchanged

### Requirement: The index stays outside Git

The extension SHALL store the index and its state in `session-history/` under Pi's agent directory. The dotfiles repository SHALL ignore `/session-history/` under `.pi/agent/`.

#### Scenario: The index exists

- **WHEN** the index has been built and `git status` runs in the dotfiles repository
- **THEN** no index file appears as untracked or modified

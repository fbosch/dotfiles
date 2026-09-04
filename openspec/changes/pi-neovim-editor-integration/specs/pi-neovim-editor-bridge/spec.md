## Purpose

Provide Pi with bounded live context and presentation controls from the exact Neovim instance that launched the session without exposing general editor execution or cross-worktree data.

## ADDED Requirements

### Requirement: Connection-scoped bidirectional Neovim binding

The system SHALL bind each editor-aware Pi session to the explicit Neovim RPC socket inherited from its launcher for the lifetime of that session. One persistent Msgpack-RPC channel SHALL carry Pi requests to Neovim and allowlisted Neovim notifications to Pi. The system MUST NOT select an editor by working directory, process discovery, desktop focus, or a caller-supplied socket.

#### Scenario: Pi receives the launching editor socket

- **WHEN** Neovim launches an editor-aware Pi session
- **THEN** Pi's editor operations and inbound notifications use only the RPC channel connected to the socket inherited from that Neovim process

#### Scenario: Another editor is available

- **WHEN** the bound Neovim instance is unavailable while another Neovim instance is running
- **THEN** Pi reports the bound editor as unavailable and does not connect to the other instance

#### Scenario: Session shuts down

- **WHEN** the Pi session shuts down, reloads, or switches sessions
- **THEN** the integration removes its Neovim notification subscriptions and closes its session-scoped channel

### Requirement: Allowlisted editor notifications

The system SHALL accept only declared, schema-validated Neovim notification names with bounded payloads. Editor notifications MUST NOT trigger a model turn automatically, invoke Pi commands, or bypass Pi's normal permission and input handling.

#### Scenario: Neovim reports a focus change

- **WHEN** the bound Neovim channel sends a valid allowlisted focus notification
- **THEN** Pi updates its cached focus context without starting a model turn

#### Scenario: Neovim sends an unknown notification

- **WHEN** the bound channel sends an undeclared notification name or invalid payload
- **THEN** Pi ignores or rejects the notification without changing session state or triggering a model turn

### Requirement: Worktree-scoped editor identity

The system SHALL verify that editor context belongs to the Pi session's worktree before returning source information or performing presentation actions. Successful results SHALL identify the bound editor and the source buffer or window used.

#### Scenario: Sibling worktrees have active editors

- **WHEN** separate Pi sessions are launched from Neovim instances in sibling worktrees
- **THEN** each Pi session returns context only from its launching editor and worktree

#### Scenario: Editor context falls outside the worktree

- **WHEN** an operation targets a source path outside the bound worktree
- **THEN** the operation fails without returning source content or changing editor state

### Requirement: Live editor context

The system SHALL expose the active source buffer, cursor, editor mode, focus context, exact visual selection, visible source windows, and listed source buffers from current Neovim memory.

#### Scenario: User selects unsaved text

- **WHEN** Pi requests editor context while Neovim has an active visual selection in a modified buffer
- **THEN** the result identifies the active buffer and returns the bounded selection from Neovim memory

#### Scenario: Focus moves to the agent terminal

- **WHEN** Pi requests focus context after Neovim focus moved from a source buffer to the agent terminal
- **THEN** the result identifies the last valid source buffer recorded before that focus change

### Requirement: Bounded unsaved-buffer reads

The system SHALL read loaded source-buffer content from Neovim memory, including unsaved changes, and MUST enforce a maximum of 500 lines and 32 KiB per result.

#### Scenario: Pi reads a modified buffer

- **WHEN** Pi requests a valid range from a modified loaded source buffer
- **THEN** the result contains the current in-memory lines rather than the on-disk file contents

#### Scenario: A read exceeds its bounds

- **WHEN** a requested range or result exceeds the line or byte limit
- **THEN** the operation returns a structured limit error that explains how to narrow the request

### Requirement: Neovim diagnostic and problem-list inspection

The system SHALL expose current Neovim diagnostics, diagnostic summaries, quickfix entries, and location-list entries with bounded result sizes and source positions.

#### Scenario: Unsaved changes alter diagnostics

- **WHEN** Neovim reports diagnostics for a modified source buffer
- **THEN** Pi receives the current Neovim diagnostic state independently of Pi's disk-backed LSP state

#### Scenario: Pi inspects a location list

- **WHEN** Pi requests a valid window's location list
- **THEN** the result identifies the list owner and returns no more than the documented maximum number of entries

### Requirement: Constrained source navigation

The system SHALL reveal an existing source location only inside the bound worktree. Focus changes and split creation SHALL occur only when explicitly requested.

#### Scenario: Pi reveals a source location without focus

- **WHEN** Pi requests a valid source location without requesting focus
- **THEN** Neovim reveals the location while preserving the user's current focus

#### Scenario: Pi requests an outside-worktree location

- **WHEN** Pi requests a path outside the bound worktree
- **THEN** Neovim performs no navigation and the operation reports a containment error

### Requirement: Text-preserving presentation

The system SHALL support bounded temporary highlights, explicit highlight removal, and bounded source annotations without modifying source text. Presentation state SHALL be owned by the bridge and removable after the requesting session ends.

#### Scenario: Temporary highlight expires

- **WHEN** Pi highlights a valid source range for a bounded duration
- **THEN** Neovim removes the highlight when the duration expires without changing buffer text

#### Scenario: Annotation batch contains an invalid anchor

- **WHEN** any annotation in a batch cannot be anchored to the expected source text
- **THEN** the complete batch fails without leaving partial annotations or changing buffer text

### Requirement: Curated editor authority

The editor integration MUST NOT expose arbitrary Lua evaluation, Ex commands, key input, terminal interaction, buffer mutation, caller-selected socket routing, or notification-selected Pi actions. Errors SHALL use stable machine-readable codes with human-readable messages.

#### Scenario: Caller requests unsupported editor execution

- **WHEN** a caller attempts an operation outside the declared editor tools
- **THEN** the system performs no editor action

#### Scenario: Bound editor disconnects during a request

- **WHEN** the bound Neovim instance becomes unavailable during an editor operation
- **THEN** the operation returns a structured unavailable error and does not retry against another socket

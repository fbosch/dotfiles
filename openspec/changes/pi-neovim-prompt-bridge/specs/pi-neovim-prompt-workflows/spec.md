## Purpose

Defines observable Neovim Ask, context append, action-selection, cutover, and
rollback workflows that communicate with the exact owned Pi terminal.

## ADDED Requirements

### Requirement: Pi Ask is an explicit cancellable workflow

The system SHALL provide `:PiAsk [prefill]` through `vim.ui.input`, with Snacks
as an optional enhancement. It SHALL capture eligible source context before
opening input, permit literal Ask without source context, and submit only after
the user confirms nonempty valid text.

#### Scenario: User cancels input

- **WHEN** the user cancels `:PiAsk`
- **THEN** no terminal starts, no request is sent, no focus changes, and no
  model turn starts

#### Scenario: User submits literal text

- **WHEN** the user confirms valid literal input without a context placeholder
- **THEN** the command ensures the exact Pi session, submits one request, and
  focuses Pi only after acceptance

#### Scenario: Input opens near the editor cursor

- **WHEN** Snacks enhances `vim.ui.input`
- **THEN** Pi Ask uses cursor-relative placement above the captured source cursor,
  rather than the default editor-centered input position

#### Scenario: Native input fallback is active

- **WHEN** Snacks does not enhance `vim.ui.input`
- **THEN** `:PiAsk` retains the same submission and cancellation behavior without
  passing Snacks-specific window options to native input

### Requirement: Cold start preserves source focus until acceptance

The system SHALL support a preserve-focus Pi launcher mode for prompt requests.
Starting or restoring Pi MAY show its split, but MUST keep the captured source
window current until a matching accepted acknowledgement arrives.

#### Scenario: Cold Pi session accepts prompt

- **WHEN** `:PiAsk` must start Pi before delivery
- **THEN** source focus remains current during startup and Pi receives focus
  only after acceptance

#### Scenario: Cold start fails

- **WHEN** Pi does not bind the exact launch and session before the deadline
- **THEN** source focus is retained or restored and the prompt is not retried

### Requirement: Context snapshots are stable and bounded

The system SHALL use a compact source reference as the default Ask context.
Before opening input it SHALL capture the canonical file path, buffer ID,
`changedtick`, selection mode, selection policy, and anchor/cursor line and
column positions. Columns SHALL be one-based UTF-8 byte positions with Neovim's
virtual-cell offsets. Direction and inclusive/exclusive selection policy SHALL
be preserved. It MUST NOT copy selected source text into the prompt.

The reference MUST remain bounded regardless of the number of selected lines.
Named source references outside the bound worktree and visual selections in
unnamed or special buffers MUST fail closed. Normal Ask without an eligible
source buffer MAY remain literal.

#### Scenario: Visual context remains stable

- **WHEN** an eligible visual selection is captured before input opens
- **THEN** the prompt carries the captured source reference rather than
  input-window focus or a later selection

#### Scenario: Source changes while input is open

- **WHEN** the captured buffer's path or changed tick changes before request
  delivery
- **THEN** the request fails as stale without submitting partial context

#### Scenario: Large selection stays metadata-only

- **WHEN** the user selects a range larger than one bounded Neovim read
- **THEN** the reference is accepted without copying or truncating selected text,
  and Pi reads only the needed chunks through the bound toolkit

#### Scenario: Source changes before a guarded read

- **WHEN** Pi calls `read_buffer` with the reference's `expectedPath` and
  `expectedChangedtick`, but either no longer matches the selected buffer
- **THEN** the toolkit reports `NVIM_CONTEXT_STALE` without returning buffer text

#### Scenario: Unknown placeholder is entered

- **WHEN** a prompt contains a placeholder the bridge does not support
- **THEN** the text remains literal

### Requirement: Pi context placeholders are explicit

The system SHALL add bounded `@this`, `@buffer`, `@diagnostics`, `@quickfix`,
`@visible`, and `@buffers` context incrementally. Source text SHALL be marked as
untrusted data, worktree-contained, and sent with prompt expansion disabled.
Unavailable known context MUST cause a visible failure rather than silent
omission.

#### Scenario: Cursor `@this` is available

- **WHEN** `@this` has a valid captured source buffer without a selection
- **THEN** it identifies the captured file and cursor and directs Pi to bounded
  Neovim inspection for unsaved content

#### Scenario: Selection `@this` is available

- **WHEN** `@this` has a valid captured visual selection
- **THEN** it identifies the captured reference and directs Pi to guarded,
  bounded Neovim reads rather than embedding the selected text

#### Scenario: Known context is unavailable

- **WHEN** a known placeholder cannot produce its required bounded context
- **THEN** Ask fails before model submission and reports a stable reason

### Requirement: Neovim can append context without submission

The system SHALL provide explicit append workflows that update Pi's TUI editor,
start no turn, and focus Pi only after acknowledgement. Visual selection and
visible-buffer workflows SHALL exclude special, terminal, duplicate, and
sibling-worktree buffers.

#### Scenario: Visual context is appended

- **WHEN** the user invokes visual append with a valid bounded selection
- **THEN** Pi's existing editor text is preserved and the selected context is
  appended exactly once without a turn

#### Scenario: Visible buffers are appended

- **WHEN** the user invokes normal visible-buffer append
- **THEN** each eligible visible source buffer is represented once and no
  ineligible buffer is included

### Requirement: Actions declare their delivery behavior

The system SHALL provide a Neovim action picker only after its required Pi
prompt presets exist. Each action MUST visibly declare whether selection opens
Ask, appends editor text, or submits, and selection MUST NOT expose unsupported
OpenCode session, diff, or navigation behavior as Pi actions.

#### Scenario: User selects an Ask preset

- **WHEN** an Ask action is selected
- **THEN** Neovim opens input with the preset and does not submit until the user
  confirms it

#### Scenario: Unsupported review action is considered

- **WHEN** editable diff review has no supported Pi public API
- **THEN** it remains OpenCode-owned and is absent from Pi actions

### Requirement: Prompt mappings cut over only after workflow parity

The user-approved `<leader>ac` canary SHALL open literal Pi Ask in normal and
visual mode with empty prefill. This exception SHALL NOT imply context parity
or move the remaining OpenCode workflows. `ga`, `<A-x>`, and optionally
`<leader>as` SHALL move to Pi only after each corresponding interaction passes
its automated and live matrix.

#### Scenario: Pi Ask is still a canary

- **WHEN** literal Pi Ask is available but context or append parity is incomplete
- **THEN** `<leader>ac` opens literal Pi Ask without automatic selection context,
  while OpenCode retains append mappings and the explicit `:OpenCodeAsk` command

#### Scenario: OpenCode loads after the Ask mapping

- **WHEN** OpenCode activates after Pi's Ask mapping is installed
- **THEN** it does not replace `<leader>ac` in normal or visual mode

#### Scenario: Mapping cutover succeeds

- **WHEN** all mapped Pi prompt workflows pass their independent gates
- **THEN** the mappings move to Pi without duplicate package ownership

### Requirement: OpenCode remains an explicit rollback

The system SHALL preserve `:OpenCodeStart`, `:OpenCodeToggle`, an explicit
OpenCode Ask path, and `<leader>aO` through the retention period. Editable diff
review and clickable patch navigation SHALL remain OpenCode-owned until
supported Pi public APIs pass separate gates.

#### Scenario: Pi prompt bridge is unavailable

- **WHEN** the Pi prompt bridge fails or is rolled back
- **THEN** OpenCode Ask, append, toggle, restoration, and review remain usable

#### Scenario: Cleanup is proposed

- **WHEN** removal of OpenCode prompt wiring is considered
- **THEN** it requires a separate approved change after a Pi upgrade and a
  repeated prompt and rollback matrix

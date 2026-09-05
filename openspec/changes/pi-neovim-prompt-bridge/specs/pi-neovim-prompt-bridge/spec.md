## Purpose

Defines a bounded, explicitly user-initiated prompt ingress from the bound
Neovim instance to the exact Pi terminal session without terminal input
injection or a second transport.

## ADDED Requirements

### Requirement: Prompt requests use the existing bound channel

The system SHALL carry prompt requests and acknowledgements over the single
Msgpack-RPC channel opened from `PI_NVIM_SOCKET`. It MUST NOT discover another
socket, launch another Pi process, inject terminal input, or invoke arbitrary
Lua, Ex commands, keys, or tools.

#### Scenario: Explicit request uses the bound channel

- **WHEN** Neovim submits a prompt request for its owned Pi terminal
- **THEN** the request and acknowledgement use that terminal's existing bound
  channel

#### Scenario: Passive notification cannot submit

- **WHEN** Pi receives a focus, lifecycle, restoration, buffer, or other passive
  Neovim notification
- **THEN** no user message is submitted and no model turn starts

### Requirement: Prompt requests have exact identity

The system SHALL accept a prompt request only when its launch ID, Pi session
ID, Neovim session owner, RPC channel, editor PID, and canonical worktree match
the active terminal binding. Missing or mismatched identity MUST fail closed
without creating or selecting a fallback session.

#### Scenario: Bound identity matches

- **WHEN** every request identity matches the active terminal and channel
- **THEN** the system continues to operation and state validation

#### Scenario: Stale launch is rejected

- **WHEN** a request carries a launch ID from a replaced or pre-migration Pi
  process
- **THEN** the system rejects it without prompt or editor mutation

#### Scenario: Sibling worktree is rejected

- **WHEN** a request's canonical worktree differs from Pi's working directory
- **THEN** the system rejects it without prompt or editor mutation

### Requirement: Prompt payloads are closed and bounded

The system SHALL accept only protocol version 1 with allowlisted operations and
closed request objects. It MUST reject invalid UTF-8, NUL, whitespace-only
submissions, prompts over 16 KiB, rendered context over 32 KiB, and complete
requests over 64 KiB rather than truncating them.

#### Scenario: Valid multibyte prompt is preserved

- **WHEN** a request contains valid bounded UTF-8 including `æ`, `ø`, `å`, or
  emoji
- **THEN** the operation receives those bytes unchanged

#### Scenario: Oversized prompt is rejected

- **WHEN** a prompt exceeds the 16 KiB UTF-8 limit
- **THEN** the request fails before Pi is launched or mutated

#### Scenario: Unknown request field is rejected

- **WHEN** a request contains an unknown field, version, or operation
- **THEN** the system rejects the request as invalid

### Requirement: Submit is explicit and idle-only

The system SHALL call Pi's public user-message API exactly once for an accepted
`submit` request and SHALL disable prompt-template and extension-command
expansion. The initial protocol MUST accept submit only when the exact Pi TUI
session is idle and has no blocking prompt.

#### Scenario: Idle submit is accepted

- **WHEN** an explicit valid submit reaches an idle bound Pi TUI session
- **THEN** Pi receives the literal user text once and starts one turn

#### Scenario: Busy submit is rejected

- **WHEN** Pi is starting, streaming, blocked, replacing a session, closed, or
  in an unknown state
- **THEN** the system returns a stable failure without calling the user-message
  API

#### Scenario: Leading slash stays literal

- **WHEN** accepted text begins with a slash command or prompt-template name
- **THEN** it is delivered as literal user text rather than command dispatch

### Requirement: Append never starts a turn

The system SHALL implement `append` through Pi's public TUI editor read and
write APIs. It MUST preserve existing editor text exactly, use an explicit
caller-provided separator, and MUST NOT call the user-message API.

#### Scenario: Append preserves existing input

- **WHEN** a valid append reaches a bound Pi TUI with existing editor text
- **THEN** the exact appended text follows the existing text without starting a
  model turn

#### Scenario: Pi has no usable TUI

- **WHEN** append reaches a session without the interactive TUI editor
- **THEN** it fails without changing the session

### Requirement: Requests are at most once per launch

The system SHALL sequence requests per launch, reserve each ID before dispatch,
and retain a bounded set of outcomes. A duplicate or replay MUST NOT repeat a
Pi side effect, and an acknowledgement timeout MUST NOT cause automatic
resubmission.

#### Scenario: Duplicate arrives during dispatch

- **WHEN** an identical request ID arrives while its first dispatch is pending
- **THEN** the duplicate receives a pending failure and causes no second side
  effect

#### Scenario: Completed request is replayed

- **WHEN** an identical completed request is received again
- **THEN** the recorded acknowledgement is returned without repeating the side
  effect

#### Scenario: Request ID carries different content

- **WHEN** a known request ID is reused with different content
- **THEN** the request is rejected without a side effect

#### Scenario: Extension reload preserves replay protection

- **WHEN** the extension reloads during the same terminal launch and receives an
  already-dispatched request ID
- **THEN** the recorded acknowledgement is replayed without a second Pi side
  effect

#### Scenario: Acknowledgement is lost

- **WHEN** Neovim does not receive an acknowledgement before its deadline
- **THEN** it reports unknown delivery, retires prompt ingress for that launch,
  and does not resubmit automatically

### Requirement: Acknowledgements are correlated and limited

The system SHALL return acknowledgements to Neovim through a fixed bridge
operation on the same RPC channel. Neovim SHALL act only on an acknowledgement
matching its pending request, launch, session, and channel. Acceptance means
only that Pi synchronously invoked the relevant public API without throwing.

#### Scenario: Accepted acknowledgement focuses Pi

- **WHEN** Neovim receives a matching accepted acknowledgement
- **THEN** it focuses the owned Pi terminal after resolving the request

#### Scenario: Late acknowledgement is ignored

- **WHEN** an acknowledgement arrives after timeout, cancellation, session
  replacement, or channel cleanup
- **THEN** it causes no focus or UI side effect

### Requirement: Lifecycle cleanup invalidates prompt state

The system SHALL clear listeners, pending requests, timers, launch binding,
and session binding when the channel disconnects, the terminal closes, the
session is replaced, extensions reload, or Pi shuts down. It SHALL retain the
bounded outcome ledger and expected sequence across channel replacement and
extension reload for the lifetime of the same Pi terminal launch.

#### Scenario: Session is replaced while request waits

- **WHEN** the bound Pi session changes before dispatch or acknowledgement
- **THEN** the pending request fails and cannot reach the replacement session

#### Scenario: Channel disconnects

- **WHEN** the existing Neovim channel disconnects
- **THEN** prompt request state is released by the existing lifecycle scope

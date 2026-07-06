## ADDED Requirements

### Requirement: Key allowlist
The system SHALL accept only explicit allowlisted keyboard inputs for guarded keyboard execution.

#### Scenario: Allowed navigation key
- **WHEN** a guarded keyboard request specifies `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Enter`, `Escape`, `z`, or `x`
- **THEN** the request is eligible for policy and backend evaluation

#### Scenario: Free-form text rejected
- **WHEN** a guarded keyboard request specifies arbitrary text or a key outside the allowlist
- **THEN** the request is rejected with an unsupported-key reason before any input backend is invoked

### Requirement: Approval gate
The system SHALL require an explicit one-turn approval for the exact target before guarded keyboard input is sent.

#### Scenario: Unknown app asks but is not approved
- **WHEN** app approval returns `ask` and no explicit one-turn approval is supplied
- **THEN** guarded keyboard execution is rejected with an approval-required reason

#### Scenario: Explicit one-turn approval supplied
- **WHEN** app approval returns `ask` for the target and the caller supplies explicit one-turn approval for that target identity
- **THEN** guarded keyboard execution can proceed to target revalidation

#### Scenario: Denied or sensitive approval decision
- **WHEN** app approval returns `denied` or `sensitive`
- **THEN** guarded keyboard execution is rejected and no input backend is invoked

### Requirement: Target revalidation
The system SHALL re-read Hyprland state and verify the current target immediately before sending keyboard input.

#### Scenario: Target identity still matches
- **WHEN** the current Hyprland target matches the approved stable ID, class, title, workspace, and monitor constraints
- **THEN** guarded keyboard execution can proceed to backend evaluation

#### Scenario: Target drift detected
- **WHEN** the current Hyprland target differs from the approved target identity
- **THEN** guarded keyboard execution is rejected with a target-drift reason and records current and approved target metadata

#### Scenario: No current target
- **WHEN** no active target can be resolved immediately before input
- **THEN** guarded keyboard execution is rejected with a missing-target reason

### Requirement: Backend availability
The system SHALL use only an explicitly configured keyboard backend and SHALL fail closed when no backend is available.

#### Scenario: No keyboard backend configured
- **WHEN** guarded keyboard execution passes policy and target checks but no approved backend is configured
- **THEN** the request is rejected with a no-input-backend reason

#### Scenario: Backend command unavailable
- **WHEN** the configured keyboard backend command is not available at execution time
- **THEN** the request is rejected with a no-input-backend reason and no fallback backend is used

#### Scenario: Backend succeeds
- **WHEN** the configured backend sends the allowlisted key successfully
- **THEN** the result records the backend name, key, target identity, and evidence paths

### Requirement: Evidence around input
The system SHALL record before/after evidence for guarded keyboard attempts.

#### Scenario: Successful key execution
- **WHEN** guarded keyboard input is sent
- **THEN** evidence includes the approval decision, target identity, key, backend, before capture metadata, after capture metadata, and timestamps

#### Scenario: Rejected key execution
- **WHEN** guarded keyboard execution is rejected
- **THEN** evidence includes the rejection reason, requested key, requested target metadata when available, and no clipboard contents or inline screenshot bytes

### Requirement: Unsafe target preservation
The system SHALL preserve existing denied target boundaries for guarded keyboard execution.

#### Scenario: Terminal target
- **WHEN** the target is a terminal emulator
- **THEN** guarded keyboard execution is rejected and recommends normal OpenCode shell tools

#### Scenario: OpenCode or Codex target
- **WHEN** the target is OpenCode, Codex, an agent approval window, or a tool-permission window
- **THEN** guarded keyboard execution is rejected

#### Scenario: Privileged prompt target
- **WHEN** the target is a sudo, Polkit, password, keychain, authentication, system security, or browser permission prompt
- **THEN** guarded keyboard execution is rejected and requires human handling

#### Scenario: Browser page interaction
- **WHEN** the request is browser page interaction
- **THEN** guarded keyboard execution is rejected and recommends `agent-browser` or available `chrome-devtools` tools

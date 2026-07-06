## ADDED Requirements

### Requirement: Explicit keyboard input model
The system SHALL accept only explicit keys, chords, or short key sequences for guarded keyboard execution.

#### Scenario: Single key
- **WHEN** a guarded keyboard request specifies a single supported key such as `ArrowUp`, `Enter`, `Escape`, `z`, `F5`, `Space`, or `Tab`
- **THEN** the request is eligible for policy and backend evaluation

#### Scenario: Key chord
- **WHEN** a guarded keyboard request specifies an explicit chord such as `Ctrl+S` or `Alt+Enter`
- **THEN** the request is eligible for policy and backend evaluation if the backend can represent the chord

#### Scenario: Short key sequence
- **WHEN** a guarded keyboard request specifies a short sequence of explicit keys or chords
- **THEN** each item is evaluated and dispatched in order only after approval and target revalidation pass

#### Scenario: Free-form text rejected
- **WHEN** a guarded keyboard request specifies arbitrary text intended for typing rather than explicit keys/chords
- **THEN** the request is rejected with a text-input-unsupported reason before any input backend is invoked

#### Scenario: Unsupported key rejected
- **WHEN** a guarded keyboard request specifies a key or chord the configured backend cannot represent
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
The system SHALL re-read Hyprland state and verify the approved target immediately before sending keyboard input.

#### Scenario: Target identity still matches
- **WHEN** the approved Hyprland target still exists in current clients and matches the approved stable ID, class, title, workspace, and monitor constraints
- **THEN** guarded keyboard execution can proceed to backend evaluation

#### Scenario: Another window is active
- **WHEN** another window is active but the approved target still exists and matches the approved identity
- **THEN** guarded keyboard execution can target the approved window selector without requiring focus

#### Scenario: Target drift detected
- **WHEN** the matching Hyprland client differs from the approved target identity
- **THEN** guarded keyboard execution is rejected with a target-drift reason and records current and approved target metadata

#### Scenario: Approved target disappeared
- **WHEN** no current client matches the approved stable ID or address immediately before input
- **THEN** guarded keyboard execution is rejected with a missing-target reason

#### Scenario: Unsafe XWayland targeted dispatch
- **WHEN** the approved target and the active window are different XWayland windows
- **THEN** guarded keyboard execution is rejected with a no-input-backend reason before dispatch

### Requirement: Hyprland targeted backend
The system SHALL prefer Hyprland targeted keyboard dispatchers for guarded keyboard execution.

#### Scenario: Stable ID target available
- **WHEN** the approved target has a stable ID
- **THEN** the Hyprland backend targets the window with `stableid:<stableId>`

#### Scenario: Stable ID unavailable
- **WHEN** the approved target has no stable ID but has a Hyprland address
- **THEN** the Hyprland backend targets the window with an address selector and records the weaker selector in evidence

#### Scenario: No strong selector available
- **WHEN** neither stable ID nor address is available for the approved target
- **THEN** guarded keyboard execution is rejected before any input backend is invoked

### Requirement: Backend availability
The system SHALL use only an approved targeted keyboard backend and SHALL fail closed when no backend is available.

#### Scenario: Hyprland dispatcher unavailable
- **WHEN** guarded keyboard execution passes policy and target checks but Hyprland targeted dispatch is unavailable
- **THEN** the request is rejected with a no-input-backend reason

#### Scenario: Backend command unavailable
- **WHEN** the configured keyboard backend command is not available at execution time
- **THEN** the request is rejected with a no-input-backend reason and no fallback backend is used

#### Scenario: Backend succeeds
- **WHEN** the configured backend sends the explicit key, chord, or sequence successfully
- **THEN** the result records the backend name, input description, target identity, selector, and evidence paths

#### Scenario: Generic input fallback unavailable
- **WHEN** Hyprland targeted dispatch is unavailable
- **THEN** the system does not silently fall back to focused/global tools such as `wtype`, `ydotool`, `dotool`, `evemu`, libei, or XTest

### Requirement: Evidence around input
The system SHALL record before/after evidence for guarded keyboard attempts.

#### Scenario: Successful key execution
- **WHEN** guarded keyboard input is sent
- **THEN** evidence includes the approval decision, target identity, input description, backend, target selector, before capture metadata, after capture metadata, and timestamps

#### Scenario: Rejected key execution
- **WHEN** guarded keyboard execution is rejected
- **THEN** evidence includes the rejection reason, requested input, requested target metadata when available, and no clipboard contents or inline screenshot bytes

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

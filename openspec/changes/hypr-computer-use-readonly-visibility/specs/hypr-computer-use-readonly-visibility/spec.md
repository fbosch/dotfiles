## ADDED Requirements

### Requirement: Hyprland state discovery is read-only
The system SHALL discover Hyprland monitors, workspaces, clients, and active-window state without mutating compositor, application, clipboard, input, or lockscreen state.

#### Scenario: State discovery succeeds
- **WHEN** Hyprland IPC is available and the user requests current desktop state
- **THEN** the system returns monitors, workspaces, clients, and active-window metadata
- **AND** it does not dispatch Hyprland mutations, inject input, or modify clipboard contents

#### Scenario: Hyprland IPC is unavailable
- **WHEN** Hyprland IPC cannot be queried
- **THEN** the system fails with an explicit unavailable-state error
- **AND** it does not fall back to input automation or screenshot-only target inference

### Requirement: Active target snapshots are normalized
The system SHALL represent the active target as a normalized point-in-time snapshot suitable for future verification.

#### Scenario: Active window is present
- **WHEN** Hyprland reports an active window
- **THEN** the snapshot includes the window address, class, title, PID when available, workspace, monitor, geometry, floating state, fullscreen state, and timestamp

#### Scenario: Active window is missing
- **WHEN** Hyprland does not report an active window
- **THEN** the system returns a no-active-target result
- **AND** it does not guess a target from screenshots, cursor position, or most-recent client ordering

#### Scenario: Active target is ambiguous
- **WHEN** multiple clients match the active target identity or required identity fields are inconsistent
- **THEN** the system fails closed with an ambiguous-target error
- **AND** it does not select one client arbitrarily

### Requirement: Screenshot capture uses explicit scopes
The system SHALL capture screenshots only for explicit scopes: active window, monitor, region, or full desktop.

#### Scenario: Active-window capture
- **WHEN** the user requests an active-window screenshot and the active window can be resolved
- **THEN** the system captures only the active-window scope when the configured backend supports it
- **AND** the capture result is linked to the active target snapshot

#### Scenario: Monitor capture
- **WHEN** the user requests a monitor screenshot with a monitor identifier
- **THEN** the system captures the requested monitor scope when the configured backend supports it
- **AND** the capture result records the monitor metadata used for targeting

#### Scenario: Region capture with explicit geometry
- **WHEN** the user requests a region screenshot with explicit region geometry
- **THEN** the system captures only that region when the configured backend supports it
- **AND** the capture result records the region geometry

#### Scenario: Region capture without explicit geometry in non-interactive context
- **WHEN** the user requests region capture without region geometry and interactive selection is unavailable
- **THEN** the system fails with a region-required error
- **AND** it does not widen the capture to monitor or full desktop scope

#### Scenario: Full-desktop capture
- **WHEN** the user explicitly requests full-desktop capture
- **THEN** the system captures the full desktop only if the configured policy allows that scope
- **AND** the capture result records that the widest scope was used

### Requirement: Capture backends are detected, not installed
The system SHALL use configured or discoverable screenshot backends without installing system packages or modifying host package configuration.

#### Scenario: Compatible backend exists
- **WHEN** a compatible screenshot backend is available for the requested scope
- **THEN** the system uses that backend and records the backend name in the capture result

#### Scenario: No compatible backend exists
- **WHEN** no compatible screenshot backend is available for the requested scope
- **THEN** the system fails with a missing-backend error naming the requested scope
- **AND** it does not install packages, alter system configuration, or try privileged alternatives

### Requirement: Evidence records are metadata-first
The system SHALL write task-local evidence records for visibility operations without embedding screenshot image data inline.

#### Scenario: State snapshot is recorded
- **WHEN** the system creates a target snapshot
- **THEN** it records metadata including timestamp, target identity, workspace, monitor, and operation type
- **AND** it does not include image bytes or clipboard contents in the metadata record

#### Scenario: Screenshot capture is recorded
- **WHEN** the system captures a screenshot
- **THEN** it records the screenshot file path, capture scope, backend, target metadata when applicable, and timestamp
- **AND** it does not duplicate the screenshot image data inside the evidence log

### Requirement: Side-effecting computer-use features remain unavailable
The system SHALL reject side-effecting desktop automation requests in this capability.

#### Scenario: Input automation is requested
- **WHEN** a caller requests clicking, typing, pointer movement, keyboard injection, or compositor-dispatch mutation
- **THEN** the system rejects the request as out of scope for read-only visibility
- **AND** it does not partially execute the requested action

#### Scenario: Clipboard mutation is requested
- **WHEN** a caller requests clipboard read or write behavior
- **THEN** the system rejects the request as out of scope for read-only visibility
- **AND** it does not inspect or modify clipboard contents

#### Scenario: Locked-session control is requested
- **WHEN** a caller requests lockscreen bypass, temporary unlock, or locked-session GUI operation
- **THEN** the system rejects the request as unsupported
- **AND** it does not install privileged helpers, PAM hooks, or locker integration

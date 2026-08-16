## Purpose

Use locally available accessibility geometry to tighten an AI Pointer capture when one semantic target clearly matches the completed gesture.

## ADDED Requirements

### Requirement: Explicit bounded accessibility lookup
The AI Pointer SHALL query accessibility data only after an explicit completed gesture. Lookup SHALL be limited to the active Hyprland client, bounded by process, call, node, depth, candidate, helper-output, and helper wall-clock limits, and cancelled with the owning run. Helper output limits SHALL be enforced while reading rather than after unbounded buffering.

#### Scenario: User completes a gesture over the active application
- **WHEN** the stroke produces valid fallback geometry
- **THEN** the system may perform one bounded local lookup for that run

#### Scenario: Workflow is idle
- **WHEN** no AI Pointer run is resolving a completed gesture
- **THEN** the system does not inspect accessibility trees or retain accessible objects

### Requirement: High-confidence automatic snapping
The AI Pointer SHALL replace stroke-derived capture geometry only when one visible, showing, non-sensitive accessible candidate has an eligible semantic role, a high-confidence geometric match, and is not ambiguous with another candidate. The candidate and final padded geometry SHALL remain wholly inside the matched active client. It SHALL otherwise preserve the validated stroke geometry.

#### Scenario: One control clearly matches the gesture
- **WHEN** one candidate contains the selection center, is substantially covered by the gesture, has compatible area, and exceeds the confidence and ambiguity thresholds
- **THEN** the system captures bounded padded geometry around that accessible candidate

#### Scenario: Candidates are ambiguous
- **WHEN** multiple geometrically distinct candidates have similar confidence
- **THEN** the system captures the original stroke-derived geometry

#### Scenario: Candidate is a generic container or crosses the client edge
- **WHEN** a candidate has an unknown or generic container role, or its candidate or padded bounds leave the active client
- **THEN** the system captures the original stroke-derived geometry

#### Scenario: Accessibility is unavailable or inconsistent
- **WHEN** the bus, application tree, helper, coordinates, process identity, or timeout cannot produce a validated candidate
- **THEN** capture continues with the original stroke-derived geometry

### Requirement: Wayland coordinate reconciliation
The AI Pointer SHALL treat AT-SPI window coordinates as application-local and translate them using the matching Hyprland client's global origin. The matching AT-SPI top-level SHALL be the one uniquely active or focused dimension-compatible top-level for the matched process. Approximate dimensions alone MUST NOT select among multiple top-levels. It MUST NOT treat GTK Wayland screen coordinates as compositor-global facts.

#### Scenario: Accessible bounds match the active Hyprland client
- **WHEN** the AT-SPI top-level window dimensions agree with the active client within the bounded tolerance
- **THEN** candidate window coordinates are translated to Hyprland global coordinates for scoring and capture

#### Scenario: Window dimensions disagree
- **WHEN** the accessibility top-level and compositor client dimensions differ beyond tolerance
- **THEN** the system rejects accessibility snapping for that run

#### Scenario: Active client changes during lookup
- **WHEN** the client's identity, PID, origin, size, mapped state, hidden state, or focus changes before the accessibility result is accepted
- **THEN** the system treats the result as stale and captures the original stroke-derived geometry

### Requirement: Local privacy-minimized metadata
The AI Pointer MAY show the selected candidate's bounded accessible name and role in the local preview. It MUST NOT query accessible text interfaces, descriptions, editable values, or password content, and MUST NOT persist, log, or add accessibility metadata to an AI-facing payload. If a sampled ancestry contains a password role, no node from that ancestry SHALL contribute geometry or metadata.

#### Scenario: Capture snaps successfully
- **WHEN** the local preview is shown
- **THEN** it identifies the local accessible role and optional bounded name and states that the metadata remains local

#### Scenario: Capture is discarded
- **WHEN** the user closes the preview
- **THEN** the copied accessibility metadata is discarded with the run

### Requirement: Versioned helper boundary
The accessibility helper request and response SHALL carry an exact protocol version and coordinate-space identifier. Missing, unknown, upgraded, downgraded, or mismatched values SHALL fail safely to stroke-derived geometry.

#### Scenario: Helper and controller versions disagree
- **WHEN** the deployed helper does not return the controller's exact protocol version and window coordinate space
- **THEN** the system ignores the helper result and captures the original stroke-derived geometry

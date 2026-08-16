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

### Requirement: Fuzzy bounded automatic snapping
The AI Pointer SHALL replace stroke-derived capture geometry only when one visible, showing, non-sensitive accessible target has an eligible semantic role and the combined padded overlap, center affinity, relative size, and repeated-hit evidence distinguish it from alternatives. A target MAY be one candidate or a repeatedly hit common ancestor of multiple related candidates. The candidate and final padded geometry SHALL remain wholly inside the matched active client. It SHALL otherwise preserve the validated stroke geometry.

#### Scenario: One control fuzzily matches the gesture
- **WHEN** one candidate overlaps the capture-padding tolerance, has compatible area, and its combined geometric score exceeds the confidence and ambiguity thresholds
- **THEN** the system captures bounded padded geometry around that accessible candidate

#### Scenario: Painted brush crosses a target
- **WHEN** a bounded centerline or brush-edge sample resolves through an eligible accessible target even though the region grid misses it
- **THEN** that hit contributes to the same bounded fuzzy ranking policy

#### Scenario: Candidates are ambiguous
- **WHEN** multiple geometrically distinct candidates have similar confidence
- **THEN** the system captures the original stroke-derived geometry

#### Scenario: Gesture covers related targets
- **WHEN** several sampled points resolve through one bounded common ancestor whose geometry confidently matches the gesture
- **THEN** the system captures padded geometry around that common ancestor

#### Scenario: Gesture covers part of one bounded target
- **WHEN** the padded selection substantially overlaps one target that is no more than five times the selection area
- **THEN** the system may expand capture to that target's padded geometry

#### Scenario: Gesture center is near a direct target
- **WHEN** the helper reports a link or image and the gesture center is no farther than the capture padding outside its bounds
- **THEN** the system may treat it as a direct target while preferring an actual center hit

#### Scenario: Gesture is inside a larger named common ancestor
- **WHEN** at least seven of nine sampled points resolve through one named section or article no more than twelve times the selection area
- **THEN** the system may expand capture to that ancestor while unnamed and full-page containers remain ineligible

#### Scenario: Gesture center is inside an image
- **WHEN** the center sample resolves through an accessible image
- **THEN** the system selects the complete image regardless of area ratio, subject to client and capture bounds

#### Scenario: Image is inside a link
- **WHEN** the center sample resolves through an image and an enclosing accessible link
- **THEN** the system selects the complete link container rather than the nested image

#### Scenario: Candidate is a generic container or crosses the client edge
- **WHEN** a candidate has an unknown or generic container role, or its candidate or padded bounds leave the active client
- **THEN** the system captures the original stroke-derived geometry

#### Scenario: Accessibility is unavailable or inconsistent
- **WHEN** the bus, application tree, helper, coordinates, process identity, or timeout cannot produce a validated candidate
- **THEN** capture continues with the original stroke-derived geometry

### Requirement: Wayland coordinate reconciliation
The AI Pointer SHALL treat AT-SPI window coordinates as application-local and translate them using the matching Hyprland client's global origin. It SHALL prefer a uniquely active or focused dimension-compatible top-level for the matched process. When sandboxing proxies the accessibility connection under another PID, it MAY use the one uniquely active or focused dimension-compatible top-level across registered applications. Approximate dimensions alone MUST NOT select among multiple top-levels. It MUST NOT treat GTK Wayland screen coordinates as compositor-global facts.

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
The AI Pointer MAY show the selected candidate's bounded accessible name, role, geometry, center-hit status, hit count, confidence, optional HTTP or HTTPS Hyperlink URL, and bounded active-program class, title, and process ID in the local preview. It MUST NOT query accessible text interfaces, descriptions, editable values, or password content, and MUST NOT persist, log, or add accessibility metadata to an AI-facing payload. URLs from non-link roles, non-web schemes, values containing whitespace or control characters, and oversized values SHALL be discarded. If a sampled ancestry contains a password role, no node from that ancestry SHALL contribute geometry or metadata.

#### Scenario: Capture snaps successfully
- **WHEN** the local preview is shown
- **THEN** it identifies the bounded local program and accessible target, shows the geometric and scoring evidence used for the match, and states that the metadata remains local

#### Scenario: Selected link exposes a web URL
- **WHEN** the winning link candidate provides one bounded valid HTTP or HTTPS Hyperlink URI
- **THEN** the local preview may show that URL without persisting, logging, or adding it to an AI-facing payload

#### Scenario: Capture is discarded
- **WHEN** the user closes the preview
- **THEN** the copied accessibility metadata is discarded with the run

### Requirement: Versioned helper boundary
The accessibility helper request and response SHALL carry an exact protocol version and coordinate-space identifier. Missing, unknown, upgraded, downgraded, or mismatched values SHALL fail safely to stroke-derived geometry.

#### Scenario: Helper and controller versions disagree
- **WHEN** the deployed helper does not return the controller's exact protocol version and window coordinate space
- **THEN** the system ignores the helper result and captures the original stroke-derived geometry

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
The AI Pointer SHALL replace stroke-derived capture geometry only when visible, showing, non-sensitive accessible targets have eligible semantic roles and the combined padded overlap, center affinity, relative size, and repeated-hit evidence distinguish them from alternatives. A result MAY be one candidate, a repeatedly hit common ancestor, or a bounded collection of distinct candidates. Every candidate and the final padded geometry SHALL remain wholly inside the matched active client. It SHALL otherwise preserve the validated stroke geometry.

#### Scenario: One control fuzzily matches the gesture
- **WHEN** one candidate overlaps the capture-padding tolerance, has compatible area, and its combined geometric score exceeds the confidence and ambiguity thresholds
- **THEN** the system captures bounded padded geometry around that accessible candidate

#### Scenario: GTK exposes an ordinary button role
- **WHEN** an otherwise eligible actionable control is reported as `button` rather than `push button`
- **THEN** click and stroke targeting treat it with the same actionable priority

#### Scenario: Painted brush crosses a target
- **WHEN** a bounded centerline or brush-edge sample resolves through an eligible accessible target even though the region grid misses it
- **THEN** that hit contributes to the same bounded fuzzy ranking policy

#### Scenario: Candidates are ambiguous
- **WHEN** multiple geometrically distinct candidates have similar confidence
- **THEN** the system captures the original stroke-derived geometry

#### Scenario: Gesture covers related targets
- **WHEN** a closed enclosing gesture resolves through one bounded common ancestor whose geometry confidently matches the gesture
- **THEN** the system captures padded geometry around that common ancestor

#### Scenario: Open stroke crosses distinct targets
- **WHEN** an open stroke crosses two to eight strong non-overlapping semantic candidates that satisfy the bounded collection rules
- **THEN** the system captures their padded union instead of selecting their enclosing common ancestor

#### Scenario: Hand-drawn loop overlaps at its closure
- **WHEN** the final drawn segment overlaps the first segment only within the shared brush footprint and encloses distinct targets
- **THEN** the system treats the gesture as closed for bounded interior candidate discovery

#### Scenario: Gesture intentionally covers multiple distinct targets
- **WHEN** two to eight strong non-overlapping semantic candidates have centers inside the selection, no clear common ancestor supersedes them, their combined area occupies at least fifteen percent of their bounded union, and that union is no more than five times the selection area
- **THEN** the system captures the padded union and returns local per-target role, name, URL, geometry, hit-count, and confidence metadata as a collection

#### Scenario: Candidate collection is sparse or overlapping
- **WHEN** possible members substantially overlap, leave a large unexplained gap, exceed the collection limit, or include only one strong distinct target
- **THEN** the system does not manufacture a collection and continues with the ordinary single-target or fallback policy

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

#### Scenario: Drawn row contains a nested title link
- **WHEN** multiple center-hit links are nested on the same hit path or a repeatedly hit list-item ancestor contains the title link
- **THEN** the system prefers the link or list item whose overlap and area best match the drawn row rather than automatically selecting the smallest title bounds

#### Scenario: Candidate is a generic container or crosses the client edge
- **WHEN** a candidate has an unknown or generic container role, or its candidate or padded bounds leave the active client
- **THEN** the system captures the original stroke-derived geometry

#### Scenario: Accessibility is unavailable or inconsistent
- **WHEN** the bus, application tree, helper, coordinates, process identity, or timeout cannot produce a validated candidate
- **THEN** capture continues with the original stroke-derived geometry

### Requirement: Focused click capture
The AI Pointer SHALL interpret a completed gesture below the minimum stroke span as a click. It SHALL first attempt one bounded point accessibility lookup. An eligible center-hit target containing the click MAY replace fallback geometry, with actionable controls and links preferred over images and textual content and smaller targets preferred within each tier. Selected target capture SHALL include 24 pixels of context, SHALL be capped to 384 by 384 pixels around the click, and SHALL remain within the clicked monitor. When no reliable target is available, the system SHALL capture a 256 by 256 pixel region centered on the click and clamped to the clicked monitor.

#### Scenario: Click resolves an actionable target
- **WHEN** one eligible actionable target contains the click and is reported as a center hit
- **THEN** the system captures its padded, capped, monitor-clamped geometry and shows its local metadata

#### Scenario: Click has no reliable accessible target
- **WHEN** accessibility is absent, unavailable, inconsistent, or returns no eligible center-hit candidate containing the click
- **THEN** the system captures the monitor-clamped 256 by 256 pixel fallback centered on the click

#### Scenario: Click is near a monitor edge
- **WHEN** either target or fallback capture would cross the clicked monitor boundary
- **THEN** the system shifts or crops the capture to remain wholly inside that monitor

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
The AI Pointer MAY show each selected candidate's bounded accessible name, role, geometry, center-hit status, hit count, confidence, optional HTTP or HTTPS Hyperlink URL, and a bounded collection of coordinate-matched program class, title, process ID, geometry, and capture coverage in the local preview. Program identity SHALL come from mapped visible Hyprland clients with meaningful final-capture intersection and SHALL NOT depend on AT-SPI availability. The active client SHALL take precedence, and a lower-ranked client whose selected intersection is wholly covered by a higher-ranked window SHALL be omitted. Collection metadata SHALL remain bounded to the selected members. It MUST NOT query accessible text interfaces, descriptions, editable values, or password content, and MUST NOT persist, log, or add accessibility metadata to an AI-facing payload. URLs from non-link roles, non-web schemes, values containing whitespace or control characters, and oversized values SHALL be discarded. If a sampled ancestry contains a password role, no node from that ancestry SHALL contribute geometry or metadata.

#### Scenario: Capture snaps successfully
- **WHEN** the local preview is shown
- **THEN** it identifies the bounded local program and accessible target, shows the geometric and scoring evidence used for the match, and states that the metadata remains local

#### Scenario: Matched program exposes no accessibility tree
- **WHEN** the selection center lies inside a mapped visible Hyprland client but AT-SPI returns no reliable element
- **THEN** the preview still identifies the bounded program class, title, process ID, and geometry while reporting stroke-geometry fallback for the element

#### Scenario: Capture spans multiple visible programs
- **WHEN** multiple mapped visible clients each cover at least five percent of the final capture and are not fully occluded within the selected region by a higher-ranked client
- **THEN** the preview lists up to eight programs ordered by active-client precedence, focus history, and capture coverage

#### Scenario: Local candidate diagnostics are enabled
- **WHEN** accessibility lookup returns candidates whether or not one is selected
- **THEN** the preview may show up to twelve bounded deduplicated candidates with selected status, role, name, geometry, center and hit evidence, score, and a stable rejection reason without adding diagnostics to capture or AI-facing metadata

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

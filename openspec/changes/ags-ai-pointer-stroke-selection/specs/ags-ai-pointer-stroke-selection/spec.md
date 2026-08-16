## Purpose

Let the user draw around desktop content and preview a capture whose bounds are derived predictably from the complete gesture.

## ADDED Requirements

### Requirement: Explicit bounded stroke collection
The AI Pointer SHALL collect pointer coordinates only after explicit activation and only until release or cancellation. It SHALL bound retained drawing points and MUST NOT perform ambient pointer observation while idle.

#### Scenario: User starts drawing
- **WHEN** the user presses the AI Pointer binding while the workflow is idle
- **THEN** the system starts one bounded stroke and records the activation coordinate

#### Scenario: Workflow is idle
- **WHEN** no AI Pointer drawing gesture is active
- **THEN** the system does not sample or retain pointer coordinates

### Requirement: Visible multi-monitor drawing feedback
The AI Pointer SHALL render the active stroke on temporary click-through overlay surfaces using global desktop coordinates. The feedback SHALL follow the stroke across monitor boundaries and SHALL be removed on release, cancellation, failure, or shutdown.

#### Scenario: Stroke crosses monitors
- **WHEN** the user draws across two configured monitors
- **THEN** the system renders the corresponding portion of the stroke on each monitor without changing the global capture coordinates

#### Scenario: User cancels while drawing
- **WHEN** the drawing gesture is cancelled before capture
- **THEN** all stroke surfaces are hidden and retained stroke coordinates are discarded

### Requirement: Capture bounds derive from the complete stroke
The AI Pointer SHALL derive one capture rectangle from the minimum and maximum global coordinates reached by the stroke, add bounded padding, and validate the result against the existing capture limits. It MUST NOT reinterpret the gesture as an endpoint rectangle or semantic UI target in this change.

#### Scenario: User draws around content
- **WHEN** the completed stroke has valid two-dimensional bounds within the capture limit
- **THEN** the system captures the padded bounding rectangle of the complete stroke

#### Scenario: Stroke finishes near its start
- **WHEN** a circular stroke ends near its activation coordinate
- **THEN** the system uses the extrema reached throughout the stroke rather than producing a near-empty endpoint rectangle

#### Scenario: Stroke is too small or too large
- **WHEN** the completed stroke lacks minimum two-dimensional extent or exceeds the configured capture limit
- **THEN** the system cancels or fails safely without retaining or submitting a capture

### Requirement: Reviewed local result
The AI Pointer SHALL remove drawing feedback before capture and show the validated captured image in the existing local preview. Stroke coordinates MUST remain local and MUST NOT be included in a provider payload in this change.

#### Scenario: Capture succeeds
- **WHEN** the padded stroke bounds produce a valid image
- **THEN** the drawing overlay disappears and the existing reviewed capture preview is shown

#### Scenario: Capture is discarded
- **WHEN** the user discards the preview
- **THEN** the capture and stroke state are removed without sending stroke coordinates or image content

### Requirement: Accessibility remains inactive
The installed accessibility runtime MAY remain available for later enrichment, but this change MUST NOT query accessibility trees, accessible names, roles, text, or bounds while deriving a capture.

#### Scenario: Drawing completes while AT-SPI is available
- **WHEN** the accessibility bus and application accessibility trees are available
- **THEN** capture bounds still derive only from the reviewed stroke coordinates and padding policy

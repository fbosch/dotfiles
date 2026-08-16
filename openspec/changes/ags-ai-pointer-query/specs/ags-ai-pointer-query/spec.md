## Purpose

Let a user explicitly drag-select a desktop region, ask a short question about the reviewed selection, and receive a safe read-only AI answer without ambient screen observation or desktop automation.

## ADDED Requirements

### Requirement: Explicit single-run selection workflow
The AI Pointer SHALL start only through an explicit user activation. It SHALL allow one active workflow at a time and provide drag selection, composition, requesting, answer, failure, and cancellation states. A second activation while a workflow is active MUST NOT start another selector.

#### Scenario: User starts a selection
- **WHEN** the user triggers the AI Pointer binding while it is idle
- **THEN** the system begins one drag-selection workflow

#### Scenario: User activates while busy
- **WHEN** the user triggers the binding while selection, composition, requesting, answer, or failure is active
- **THEN** the system preserves the existing workflow and does not start a second selector

### Requirement: Drag selection and capture preview
The AI Pointer SHALL let the user drag a region in Hyprland global coordinates, capture only that validated region, and show a preview before any image or metadata is submitted. Cancelling selection MUST return to idle without a request.

#### Scenario: User selects a region
- **WHEN** the user completes a drag selection with valid positive dimensions within the configured capture limit
- **THEN** the system captures and previews that region before accepting a question

#### Scenario: User cancels selection
- **WHEN** the user dismisses the region selector
- **THEN** the system returns to idle without retaining or submitting a capture

### Requirement: Exact and inferred compositor context
The AI Pointer SHALL attach bounded Hyprland context for the selection geometry, monitor, workspace, active-window relationship, intersecting client candidates, and intersecting layer candidates. It SHALL classify a labelled whole-window selection as exact only after revalidating that client. It SHALL classify freeform rectangle matches as geometric inference and MUST NOT present inferred candidates as compositor hit-test or z-order facts.

#### Scenario: Whole-window selection remains valid
- **WHEN** the user selects a labelled client rectangle and that client still matches the post-selection compositor snapshot
- **THEN** the request identifies one exact selected window

#### Scenario: Freeform selection crosses applications
- **WHEN** a selected region intersects more than one client or layer surface
- **THEN** the request contains ranked geometric candidates and identifies the target relationship as inferred

### Requirement: Privacy-minimized context and explicit consent
The preview SHALL show the image and the application context that will be sent. The AI-facing context MUST omit local client addresses, stable identifiers, process identifiers, command lines, and working directories. The system SHALL send the reviewed image, typed question, and previewed context only after explicit submission.

#### Scenario: User submits a reviewed selection
- **WHEN** the user submits a non-empty question after reviewing the capture and context
- **THEN** the system sends only the previewed selection image, typed question, and privacy-minimized compositor context

#### Scenario: User cancels after preview
- **WHEN** the user cancels during composition or before submitting the question
- **THEN** the system sends no image, question, or compositor context

### Requirement: Read-only agent execution
The AI Pointer SHALL submit requests only through the fixed `desktop-pointer` agent with a deny-all tool policy. The system MUST NOT allow model output or on-screen content to run commands, mutate applications, open links, or perform desktop actions.

#### Scenario: Selected content contains hostile instructions
- **WHEN** a selected image or typed question contains instructions that request tool use or desktop changes
- **THEN** the request remains limited to read-only answer generation

### Requirement: Safe answer presentation
The AI Pointer SHALL render bounded assistant output as literal plain text near the selection or pointer monitor. It MUST NOT interpret markup, automatically activate links, execute model output, or claim that an external action was completed.

#### Scenario: Assistant returns markup-like output
- **WHEN** the assistant response contains markup, links, or command-like text
- **THEN** the system renders it as literal text without performing an action

### Requirement: Controlled cancellation and stale-result isolation
The AI Pointer SHALL support cancellation during selection, composition, requesting, answer, and failure states. Each activation SHALL own an immutable run identity, and a completion from a cancelled or superseded run MUST NOT update the current workflow or delete another run's capture.

#### Scenario: User cancels an active request and starts another
- **WHEN** the user cancels request A and begins request B before A's subprocess completes
- **THEN** a late result from A is ignored and only A's resources are cleaned up

### Requirement: Private capture lifecycle
The AI Pointer SHALL store captures only in a feature-private directory under `XDG_RUNTIME_DIR` and SHALL not fall back to shared temporary, screenshot, or clipboard locations. It SHALL remove partial captures and delete captures on every controlled terminal path. It SHALL remove stale feature-owned captures when the AGS component initializes.

#### Scenario: Controlled cancellation removes the capture
- **WHEN** the user cancels during composition or request processing
- **THEN** the system removes that run's capture from private runtime storage

#### Scenario: Capture fails partway through
- **WHEN** capture produces an incomplete or invalid image
- **THEN** the system removes the partial file, presents an error, and does not submit a request

### Requirement: Safe availability and lock behavior
The AI Pointer SHALL fail safely when required selection, capture, request-runtime, agent, server, or model capabilities are unavailable. If the Hyprland session locks during an active workflow, it SHALL cancel and hide the workflow and MUST NOT present an answer over the lock screen.

#### Scenario: Required runtime is unavailable
- **WHEN** a required local executable, agent, compatible server, or image-capable model is unavailable
- **THEN** the system returns to a non-active state with a concise failure and does not submit a capture

#### Scenario: Session locks during a request
- **WHEN** the desktop locks while the system is selecting, composing, requesting, or presenting a result
- **THEN** the system cancels or hides the workflow and cleans its controlled resources

### Requirement: Existing AI Commit isolation
The AI Pointer change SHALL NOT modify, import from, refactor, or change the behavior of `.config/opencode/plugins/ai-commit/` or `.config/fish/functions/ai_commit.fish`.

#### Scenario: AI Pointer is deployed
- **WHEN** the AI Pointer runtime and AGS workflow are installed
- **THEN** the existing AI Commit paths and their interfaces remain unchanged

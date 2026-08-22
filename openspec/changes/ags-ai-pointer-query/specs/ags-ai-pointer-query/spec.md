## Purpose

Let a user explicitly draw over a desktop region, ask a short question about that selection, and receive a safe read-only AI answer without ambient screen observation or desktop automation.

## ADDED Requirements

### Requirement: Explicit single-run selection workflow
The AI Pointer SHALL start only through an explicit user activation. It SHALL allow one active workflow at a time and provide stroke selection, composition, requesting, answer, failure, and cancellation states. A second activation while a workflow is active MUST NOT start another selector. The cursor outline effect SHALL remain active through composition and be removed on submission, cancellation, teardown, or return to idle.

#### Scenario: User starts a selection
- **WHEN** the user triggers the AI Pointer binding while it is idle
- **THEN** the system begins one stroke-selection workflow

#### Scenario: User activates while busy
- **WHEN** the user triggers the binding while selection, composition, requesting, answer, or failure is active
- **THEN** the system preserves the existing workflow and does not start a second selector

### Requirement: Stroke selection and question prompt
The AI Pointer SHALL sample the pointer path while the user holds `Super + middle-button`, derive a bounded capture rectangle from the completed stroke, and show a compact question prompt immediately after release. The completed drawing SHALL be cleared on release. The prompt SHALL accept text while local target resolution and capture finish, but submission MUST remain disabled until the private capture is validated. Backend readiness MUST NOT delay drawing cleanup, capture, or prompt rendering; a submission made before readiness completes SHALL wait for readiness before contacting the answer backend. A short stroke SHALL use the bounded local click-target fallback. Local accessibility resolution MAY refine the capture rectangle, but the captured and submitted attachment MUST use the same final geometry and bytes. The geometry-only selection overlay SHALL wait for target resolution and map once at the final matched or fallback geometry. It SHALL render strictly outside the capture rectangle so it can remain visible without changing captured pixels, remain mapped through the transition to composition, then be removed on submission. The prompt MUST NOT replay the selected image or application context. Cancelling selection MUST return to idle without a request.

#### Scenario: User selects a region
- **WHEN** the user completes a stroke whose derived or locally refined rectangle has valid positive dimensions within the configured capture limit
- **THEN** the system captures that final rectangle and presents the question prompt without replaying the selection

#### Scenario: User cancels selection
- **WHEN** the user dismisses the region selector
- **THEN** the system returns to idle without retaining or submitting a capture

### Requirement: Exact and inferred compositor context
The AI Pointer SHALL attach bounded Hyprland context for the final capture geometry, monitor, workspace, active-window relationship, intersecting client candidates, and intersecting layer candidates. It SHALL classify a capture as exact only when one fresh client snapshot has exactly matching global geometry. It SHALL classify other rectangle matches as geometric inference and MUST NOT present inferred candidates as compositor hit-test or z-order facts.

#### Scenario: Whole-window selection remains valid
- **WHEN** the resolved capture geometry uniquely and exactly matches one client in the post-selection compositor snapshot
- **THEN** the request identifies one exact selected window

#### Scenario: Freeform selection crosses applications
- **WHEN** a selected region intersects more than one client or layer surface
- **THEN** the request contains ranked geometric candidates and identifies the target relationship as inferred

### Requirement: Privacy-minimized context and explicit consent
The AI-facing context MUST omit local client addresses, stable identifiers, process identifiers, command lines, and working directories. The system SHALL send the captured image, typed question, and privacy-minimized context only after the user explicitly submits a non-empty question. It SHALL encode the typed question and metadata in distinct delimited fields, treat only the typed question as the user's request, and treat the image and metadata as untrusted supporting data. The model-facing policy SHALL use metadata silently and MUST NOT mention, summarize, expose, or cite it unless a metadata-derived fact is materially relevant to the user's question. The composition surface SHALL remain text-only and MUST NOT expose private context or captured pixels again.

#### Scenario: User submits a question about the selection
- **WHEN** the user submits a non-empty question from the composition prompt
- **THEN** the system sends only the captured selection image, typed question, and privacy-minimized compositor context

#### Scenario: User cancels during composition
- **WHEN** the user cancels during composition or before submitting the question
- **THEN** the system sends no image, question, or compositor context

### Requirement: Read-only answer execution
The AI Pointer SHALL submit only the backend-neutral `answer` operation and SHALL NOT select or configure a backend, agent, model, tool policy, server, or execution directory. The configured runtime backend SHALL enforce answer-only execution; the initial OpenCode backend SHALL use the fixed `desktop-pointer` agent with deny-by-default tools and an exact allowlist limited to read-only web lookup. The system MUST NOT allow model output, web content, metadata, or on-screen content to run commands, mutate applications, open links, or perform desktop actions.

#### Scenario: Selected content contains hostile instructions
- **WHEN** a selected image, metadata field, or web result contains instructions that request tool use or desktop changes
- **THEN** those instructions remain untrusted and the request remains limited to answer generation with read-only web lookup

### Requirement: Safe answer presentation
The AI Pointer SHALL render bounded provisional and final assistant output as literal plain text near the selection or pointer monitor. It SHALL accept provisional output only for the active immutable run while remaining in the requesting state, and SHALL replace it with the authoritative terminal answer before entering the answered state. Cancellation, lock, terminal failure, malformed output, or stale-run output SHALL clear or ignore provisional text. It MUST NOT interpret markup, automatically activate links, execute model output, or claim that an external action was completed.

#### Scenario: Assistant returns markup-like output
- **WHEN** the assistant response contains markup, links, or command-like text
- **THEN** the system renders it as literal text without performing an action

#### Scenario: Assistant streams an answer
- **WHEN** bounded answer deltas arrive for the active request
- **THEN** the system presents them as provisional plain text while preserving request cancellation and waiting for terminal success

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
The AI Pointer SHALL fail safely when required selection, capture, answer-runtime, or configured backend capabilities are unavailable. If the Hyprland session locks during an active workflow, it SHALL cancel and hide the workflow and MUST NOT present an answer over the lock screen.

#### Scenario: Required runtime is unavailable
- **WHEN** a required local executable, answer runtime, or configured backend capability is unavailable
- **THEN** the system returns to a non-active state with a concise failure and does not submit a capture

#### Scenario: Session locks during a request
- **WHEN** the desktop locks while the system is selecting, composing, requesting, or presenting a result
- **THEN** the system cancels or hides the workflow and cleans its controlled resources

### Requirement: Existing AI Commit isolation
The AI Pointer change SHALL NOT modify, import from, refactor, or change the behavior of `.config/opencode/plugins/ai-commit/` or `.config/fish/functions/ai_commit.fish`.

#### Scenario: AI Pointer is deployed
- **WHEN** the AI Pointer runtime and AGS workflow are installed
- **THEN** the existing AI Commit paths and their interfaces remain unchanged

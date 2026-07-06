## ADDED Requirements

### Requirement: Request classification
The system SHALL classify computer-use requests before selecting any desktop action path.

#### Scenario: Browser interaction request
- **WHEN** a request asks to navigate, inspect, click, type, fill a form, evaluate JavaScript, manage tabs, or extract page content in a browser
- **THEN** the route decision identifies browser automation as the structured route and does not select Hyprland input injection

#### Scenario: Desktop visibility request
- **WHEN** a request asks to inspect windows, monitors, workspaces, active targets, or screenshots
- **THEN** the route decision identifies the existing read-only Hyprland visibility capability

#### Scenario: Window management request
- **WHEN** a request asks to focus, move, resize, close, pin, fullscreen, float, or move a window or workspace
- **THEN** the route decision identifies a Hyprland-native route and requires current target resolution before execution is allowed

#### Scenario: App content request
- **WHEN** a request asks to read or change app content outside a browser
- **THEN** the route decision prefers an app-specific structured integration, file operation, CLI, DBus API, or read-only visual inspection before any GUI fallback

### Requirement: Structured route preference
The system SHALL prefer structured integrations over screenshot-driven or input-driven GUI automation.

#### Scenario: Dedicated browser tool is available
- **WHEN** a browser request can be handled by `agent-browser` or available `chrome-devtools` tools
- **THEN** the route decision recommends that tool family and does not create a browser automation session inside `hypr-computer-use`

#### Scenario: Structured route is unavailable
- **WHEN** the preferred structured route is unavailable
- **THEN** the route decision reports the unavailable route and requires explicit user direction before considering a lower-confidence fallback

#### Scenario: Direct file or shell route exists
- **WHEN** the requested outcome can be achieved through existing OpenCode file or shell tools
- **THEN** the route decision recommends those tools instead of automating a terminal or editor GUI

### Requirement: Target resolution
The system SHALL bind desktop-level route decisions to current Hyprland target metadata when a desktop target is relevant.

#### Scenario: Active window target is available
- **WHEN** a desktop-level request depends on the active window and Hyprland reports an active client
- **THEN** the route decision includes the active client's stable identity, address, class, title, PID, workspace, monitor, and fullscreen/floating state when available

#### Scenario: No active target is available
- **WHEN** a desktop-level request depends on an active target and no active client is available
- **THEN** the route decision is rejected with a missing-target reason

#### Scenario: Ambiguous target request
- **WHEN** a request names an app or window and multiple matching Hyprland clients exist
- **THEN** the route decision is rejected with an ambiguous-target reason and includes the candidate metadata needed for user selection

### Requirement: Policy denials
The system SHALL reject computer-use routes that target unsafe or unsupported contexts.

#### Scenario: Terminal GUI automation
- **WHEN** a request would click, type into, or keyboard-drive a terminal emulator GUI
- **THEN** the route decision is rejected and recommends normal OpenCode shell tools instead

#### Scenario: OpenCode self-automation
- **WHEN** a request would operate on an OpenCode, Codex, agent, approval, or tool-permission window
- **THEN** the route decision is rejected to avoid control-loop and approval-bypass behavior

#### Scenario: Privileged prompt automation
- **WHEN** a request would operate on a sudo, Polkit, keychain, password, permission, authentication, payment, account-security, or browser-permission prompt
- **THEN** the route decision is rejected and requires human handling

#### Scenario: Locked session
- **WHEN** the session is locked or a lockscreen target is detected
- **THEN** the route decision is rejected and no unlock, temporary unlock, or locked-session control path is selected

### Requirement: Clipboard boundary
The system SHALL treat clipboard reads and writes as separate sensitive capabilities, not as an implicit typing fallback.

#### Scenario: Clipboard requested as paste transport
- **WHEN** a request proposes using the clipboard to insert text into an app
- **THEN** the route decision rejects implicit clipboard mutation unless a future explicit clipboard capability and policy approval are present

#### Scenario: Clipboard content extraction
- **WHEN** a request asks to read clipboard contents
- **THEN** the route decision rejects the request unless a future explicit clipboard read capability and policy approval are present

### Requirement: Evidence records
The system SHALL write evidence for route decisions and rejections.

#### Scenario: Route decision recorded
- **WHEN** the system produces a route decision
- **THEN** the evidence record includes timestamp, request class, selected route, target metadata when available, policy outcome, and recommendation or rejection reason

#### Scenario: Rejection recorded
- **WHEN** the system rejects a request
- **THEN** the evidence record includes the rejection code and message without reading clipboard contents or inlining screenshot bytes

### Requirement: Fail-closed behavior
The system SHALL fail closed when classification, target resolution, policy evaluation, or route availability is uncertain.

#### Scenario: Unknown request class
- **WHEN** the request cannot be classified into a supported route category
- **THEN** the route decision is rejected with an unsupported-request reason

#### Scenario: Policy cannot be evaluated
- **WHEN** target metadata or policy inputs required for a safe decision are missing
- **THEN** the route decision is rejected instead of selecting a GUI fallback

#### Scenario: Future executor mismatch
- **WHEN** a future action executor receives a route decision whose target no longer matches current Hyprland state
- **THEN** the executor rejects the action and records target-drift evidence

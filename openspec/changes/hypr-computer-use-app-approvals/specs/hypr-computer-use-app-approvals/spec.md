## ADDED Requirements

### Requirement: App identity extraction
The system SHALL derive an app identity from current Hyprland target metadata before evaluating app approval.

#### Scenario: Desktop identity is available
- **WHEN** the target can be associated with a desktop entry, Flatpak ID, or browser identity
- **THEN** the app identity includes the desktop ID or Flatpak ID along with Hyprland class, title, PID, workspace, monitor, and window address when available

#### Scenario: Only Hyprland metadata is available
- **WHEN** no desktop entry or Flatpak ID can be resolved for the target
- **THEN** the app identity uses Hyprland class, title, PID, workspace, monitor, and window address and marks the identity confidence as partial

#### Scenario: No target metadata is available
- **WHEN** a request requires an app target but no target metadata can be resolved
- **THEN** the approval decision is rejected with a missing-target reason

### Requirement: Approval states
The system SHALL classify app targets into exactly one approval state: `approved`, `ask`, `denied`, or `sensitive`.

#### Scenario: Known approved app target
- **WHEN** the target matches a narrow approved identity
- **THEN** the approval decision returns `approved` with the matched identity fields

#### Scenario: Unknown normal app target
- **WHEN** the target is a normal app and does not match an approved, denied, or sensitive policy
- **THEN** the approval decision returns `ask` with prompt metadata for user review

#### Scenario: Known denied target
- **WHEN** the target matches a denied policy
- **THEN** the approval decision returns `denied` with the denial code and matched identity fields

#### Scenario: Sensitive app or action context
- **WHEN** the target or request context matches a sensitive policy but is not categorically denied
- **THEN** the approval decision returns `sensitive` and does not treat the app as approved

### Requirement: Default denials
The system SHALL deny unsafe target categories by default.

#### Scenario: Terminal GUI target
- **WHEN** the target is a terminal emulator and the request would operate through its GUI
- **THEN** the approval decision returns `denied` and recommends normal OpenCode shell tools instead

#### Scenario: OpenCode or Codex target
- **WHEN** the target is OpenCode, Codex, an agent window, an approval prompt, or a tool-permission prompt
- **THEN** the approval decision returns `denied` to prevent self-automation and approval bypass

#### Scenario: Privileged or permission prompt
- **WHEN** the target appears to be a sudo, Polkit, keychain, password, permission, authentication, system security, or browser permission prompt
- **THEN** the approval decision returns `denied` and requires human handling

#### Scenario: Locked session target
- **WHEN** the session is locked or the target appears to be a lockscreen
- **THEN** the approval decision returns `denied` and no locked-use approval is granted

### Requirement: Prompt decision metadata
The system SHALL include enough metadata in `ask` and `sensitive` decisions for a user to make an informed approval decision.

#### Scenario: Ask decision generated
- **WHEN** an approval decision returns `ask`
- **THEN** the decision includes app name when known, class, title, PID, workspace, monitor, desktop ID or Flatpak ID when known, requested route, and requested action summary

#### Scenario: Sensitive decision generated
- **WHEN** an approval decision returns `sensitive`
- **THEN** the decision includes the sensitive signals that matched and the reason ordinary app approval is insufficient

#### Scenario: Ambiguous app match
- **WHEN** multiple target candidates match the requested app identity
- **THEN** the approval decision returns `ask` or `denied` with candidate metadata and does not approve a target automatically

### Requirement: Approval scope
The system SHALL scope approval to a concrete app/window identity and route context, not to all future actions.

#### Scenario: Approved app with different target
- **WHEN** an approved app identity exists but the current target identity differs from the approved identity fields
- **THEN** the approval decision does not reuse the approval and returns `ask` or `denied` according to current policy

#### Scenario: Approved app with sensitive action
- **WHEN** the target app is approved but the request context is sensitive
- **THEN** the approval decision returns `sensitive` instead of `approved`

#### Scenario: Browser app approved
- **WHEN** a browser app target is approved for desktop visibility or window management
- **THEN** the approval decision does not grant page interaction authority inside `hypr-computer-use`

### Requirement: Persistence boundary
The system SHALL not create or mutate persistent app approval rules in the initial app approvals capability.

#### Scenario: User chooses one-time approval
- **WHEN** a user approves a prompted app target for the current decision
- **THEN** the approval applies only to the current route decision and is not stored as `Always allow`

#### Scenario: Always allow requested
- **WHEN** a request asks to persist an app approval rule
- **THEN** the system rejects persistence until a future explicit persistent policy capability exists

### Requirement: Approval evidence
The system SHALL write evidence for app approval decisions without recording sensitive content.

#### Scenario: Approval decision recorded
- **WHEN** the system evaluates an app approval
- **THEN** the evidence record includes timestamp, app identity fields, approval state, matched policy signals, requested route, and prompt or denial reason

#### Scenario: Sensitive prompt evidence
- **WHEN** the approval decision is `sensitive`
- **THEN** the evidence records matched sensitive signals without reading clipboard contents or inlining screenshot bytes

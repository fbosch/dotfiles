## 1. Discovery and Contracts

- [x] 1.1 Inspect existing `.config/opencode/plugins/` package conventions and choose the smallest file layout for `hypr-computer-use`.
- [x] 1.2 Define the normalized Hyprland state, active-target snapshot, capture request, capture result, and evidence record contracts.
- [x] 1.3 Define explicit error names for unavailable Hyprland IPC, no active target, ambiguous target, missing capture backend, region-required, and rejected side-effect requests.

## 2. Hyprland State Adapter

- [x] 2.1 Implement read-only Hyprland IPC queries for monitors, workspaces, clients, and active window state.
- [x] 2.2 Normalize Hyprland IPC output into the target snapshot contract.
- [x] 2.3 Fail closed when active-window identity is missing, inconsistent, or ambiguous.
- [x] 2.4 Add fixture-based tests or deterministic checks for state normalization and failure cases.

## 3. Capture Adapter

- [x] 3.1 Detect configured screenshot backends without installing packages or modifying system configuration.
- [x] 3.2 Implement active-window capture when the active target and backend support it.
- [x] 3.3 Implement monitor capture using explicit monitor identity.
- [x] 3.4 Implement region capture with explicit geometry and reject non-interactive region capture without geometry.
- [x] 3.5 Implement full-desktop capture behind explicit scope and policy.
- [x] 3.6 Add validation checks for missing backend and unsupported scope behavior.

## 4. Evidence Logging

- [x] 4.1 Choose the task-local evidence directory and document its cleanup expectations.
- [x] 4.2 Write metadata-first evidence records for state snapshots.
- [x] 4.3 Write metadata-first evidence records for screenshot captures, including screenshot path without embedding image bytes.
- [x] 4.4 Validate that evidence records do not include clipboard contents or inline image data.

## 5. Safety Boundaries

- [x] 5.1 Add explicit rejection paths for clicking, typing, pointer movement, keyboard injection, compositor mutations, clipboard access, and locked-session control.
- [x] 5.2 Ensure the implementation does not call Hyprland dispatchers, input-injection tools, clipboard tools, package managers, or privileged helpers.
- [x] 5.3 Document the read-only boundary in the plugin docs alongside the existing feasibility notes.

## 6. Integration and Verification

- [x] 6.1 Expose the read-only visibility capability through the chosen OpenCode plugin/tool interface or documented command entrypoint.
- [x] 6.2 Run the smallest relevant typecheck, lint, or test command for changed plugin code.
- [x] 6.3 Run a manual Hyprland smoke check for current state discovery on a live Hyprland session when available.
- [x] 6.4 Run a manual screenshot smoke check for each supported configured capture scope.
- [x] 6.5 Update `openspec` status and mark completed tasks only after the corresponding checks pass.

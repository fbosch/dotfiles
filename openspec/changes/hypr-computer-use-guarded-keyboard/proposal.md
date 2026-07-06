## Why

`hypr-computer-use` can see and classify Hyprland targets, but it still cannot perform the narrowest useful GUI action for game and desktop workflows: pressing a key. Keyboard input is the safest first input-control equivalent to macOS Computer Use because it can be constrained to explicit keys, exact target revalidation, and before/after evidence.

## What Changes

- Add a guarded keyboard capability for approved Hyprland targets.
- Limit initial input to a fixed key allowlist for navigation/game workflows.
- Require app approval, current-target revalidation, and before/after evidence before any key is sent.
- Reject target drift, denied/sensitive approval decisions, terminal GUI targets, OpenCode/Codex targets, privileged prompts, browser page interaction, missing targets, and ambiguous targets.
- Report `no-input-backend` when no safe keyboard backend is configured instead of silently falling back to unsafe injection.
- Keep pointer movement, clicking, free-form typing, clipboard paste, menu walking, browser page automation, locked-session use, and persistent app approvals out of scope.

## Capabilities

### New Capabilities

- `hypr-computer-use-guarded-keyboard`: Approval-gated, target-revalidated keyboard input for a narrow key allowlist, with before/after evidence and fail-closed backend selection.

### Modified Capabilities

- None.

## Impact

- Extends `.config/opencode/plugins/hypr-computer-use/` with the first side-effecting input capability if a safe backend is available.
- Depends on the app approval and target metadata behavior introduced by `hypr-computer-use-app-approvals`.
- May require a separately configured keyboard backend; this change does not add Nix/system packages, privileged helpers, or broad input injection by default.

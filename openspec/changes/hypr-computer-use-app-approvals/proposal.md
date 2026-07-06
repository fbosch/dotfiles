## Why

The action router defines safe route decisions, but it needs an app approval model before any desktop-level side effect can be considered. Hyprland can identify windows by class, title, PID, workspace, monitor, and desktop metadata, so app approvals can be narrower and more inspectable than generic GUI permission.

## What Changes

- Add an app approval contract for Hyprland computer-use workflows.
- Classify resolved app targets as `approved`, `ask`, `denied`, or `sensitive`.
- Bind approval decisions to current Hyprland target metadata and app identity candidates.
- Require explicit approval before future side-effecting desktop actions in apps that are not already approved.
- Deny terminal GUI automation, OpenCode/Codex self-automation, privileged prompts, permission dialogs, and locked-session targets by default.
- Keep persistent `Always allow` storage out of the first implementation unless it is narrow, explicit, and revocable.

## Capabilities

### New Capabilities

- `hypr-computer-use-app-approvals`: App identity matching, approval-state evaluation, prompt decision reporting, sensitive-target classification, and approval evidence for Hyprland computer-use route decisions.

### Modified Capabilities

- None.

## Impact

- Adds OpenSpec artifacts for `.config/opencode/plugins/hypr-computer-use/` approval behavior.
- Extends the planned action-router layer with app approval decisions.
- Does not implement click, type, pointer, keyboard, clipboard, browser automation, locked-session control, or persistent allow-list mutation in the initial slice.

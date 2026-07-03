## Why

Hyprland computer-use work needs a safe foundation before any side-effecting desktop automation. Read-only visibility gives agents enough compositor and screenshot context to identify the current target, verify UI state, and log evidence without adding input injection, clipboard mutation, or lockscreen bypasses.

## What Changes

- Add a read-only Hyprland visibility capability for discovering monitors, workspaces, clients, and the active window.
- Add explicit screenshot capture scopes for active window, monitor, region, and full desktop where supported by configured tools.
- Add a normalized target snapshot contract that pairs Hyprland metadata with optional screenshot artifacts.
- Add task-local evidence logging for visibility operations.
- Exclude clicking, typing, clipboard writes, privileged helpers, app mutation, and locked-session control from this change.

## Capabilities

### New Capabilities

- `hypr-computer-use-readonly-visibility`: Read-only Hyprland state discovery, target snapshot creation, scoped screenshot capture, and evidence logging for future computer-use workflows.

### Modified Capabilities

- None.

## Impact

- Affects the planned `.config/opencode/plugins/hypr-computer-use/` plugin area.
- May introduce local helper scripts or plugin tools for read-only Hyprland state and screenshot capture.
- Uses existing system capabilities such as Hyprland IPC, configured screenshot tools, and optional portal-backed capture.
- Does not add package management, privileged services, input injection, lockscreen integration, or external API dependencies.

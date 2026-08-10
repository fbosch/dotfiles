## Why

Window-state persistence currently keeps one geometry per selector. Moving a
window to another monitor replaces the geometry it previously used on the
first monitor, and generated rules always force the window onto the last saved
monitor.

## What Changes

- Store one floating geometry entry for each selector and monitor pair.
- Restore geometry for the monitor hosting the workspace where the window
  opens.
- Generate monitor-scoped workspace matchers instead of a `monitor` rule
  effect, so a saved location never relocates a new window to another monitor.
- Migrate existing generated single-location entries to the new representation
  without discarding their recorded geometry.
- Keep monitor names as generated metadata; do not introduce window tags.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `hypr-window-state-persistence`: Persist and restore independent floating
  geometry for each selector and monitor instead of retaining one
  last-observed geometry per selector.

## Impact

- `.config/hypr/runtime/windows/daemons/window-state/rules.lua`
- `.config/hypr/runtime/windows/daemons/window-state/window-state-daemon.lua`
- `.config/hypr/tests/window_state_rules_spec.lua`
- `.config/hypr/tests/runtime/window_state_daemon_runtime.lua`
- Generated `.config/hypr/rules/window-state.lua` format

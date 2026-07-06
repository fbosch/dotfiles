## Why

`hypr-computer-use` has safe desktop visibility and browser target detection, but it does not yet define how an agent should choose between structured tools, Hyprland-native actions, and unsafe GUI fallbacks. Without that contract, future work will drift toward generic click/type automation, which is the weakest and riskiest path on Wayland.

## What Changes

- Add an action-routing contract for Hyprland computer-use workflows.
- Require structured integrations before any desktop-level fallback.
- Treat browser interaction as delegated to dedicated tools such as `agent-browser` or `chrome-devtools`.
- Define target resolution, risk classification, policy decisions, evidence, and rejection behavior before adding side-effecting actions.
- Keep generic pointer/keyboard injection, clipboard mutation, privileged prompt automation, terminal GUI automation, OpenCode self-automation, and locked-session control out of scope.

## Capabilities

### New Capabilities

- `hypr-computer-use-action-router`: Request classification, target resolution, policy evaluation, structured-tool routing, evidence requirements, and fail-closed rejection for Hyprland computer-use workflows.

### Modified Capabilities

- None.

## Impact

- Adds OpenSpec artifacts for `.config/opencode/plugins/hypr-computer-use/` behavior.
- May later add new read-only planning/reporting modes before side-effecting runtime modes.
- Does not add browser automation dependencies, launch browsers, inject input, mutate clipboard state, or change Hyprland configuration.

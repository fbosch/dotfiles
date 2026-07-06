## Context

The plugin currently provides read-only Hyprland state, active-window snapshots, scoped screenshots, browser target discovery, and browser protocol capability reporting. It deliberately rejects click, type, pointer, keyboard, dispatch, clipboard, and locked-session modes.

The next useful layer is not generic input control. On Wayland, broad pointer and keyboard injection is brittle and security-sensitive. The Hyprland equivalent of computer use should first decide where a request belongs: existing browser automation tools, Hyprland-native window control, read-only visual inspection, app-specific integrations, or rejection.

## Goals / Non-Goals

**Goals:**

- Define a route decision model for computer-use requests.
- Prefer structured tools before visual or GUI fallbacks.
- Bind every desktop-level decision to current Hyprland target metadata.
- Make policy denials explicit, inspectable, and evidence-backed.
- Keep route decisions useful even before any side-effecting action executor exists.

**Non-Goals:**

- Do not implement browser interaction in this plugin.
- Do not implement generic pointer, keyboard, or clipboard automation.
- Do not automate terminal windows, OpenCode itself, privilege prompts, permission dialogs, or locked sessions.
- Do not create a privileged helper, compositor patch, nested compositor, or package install path.
- Do not silently launch browsers with debugging flags or mutate browser profiles.

## Decisions

### Route before act

The first implementation should produce a route decision rather than perform the requested action. A decision can identify a structured tool path, a Hyprland-native path, a visual inspection path, or a rejection.

Alternative considered: add side-effecting `click` and `type` modes immediately. That would create the weakest abstraction first and force policy to chase unsafe behavior after the fact.

### Structured integrations first

Browser interaction is delegated to `agent-browser` for general browser tasks or `chrome-devtools` for Chromium/CDP workflows when available. App-specific CLIs, DBus, APIs, and file operations should outrank screenshots and GUI input.

Alternative considered: add WebDriver BiDi client support directly. That duplicates existing browser automation tooling and expands the plugin beyond Hyprland-specific responsibilities.

### Hyprland-native actions are separate from app input

Window/workspace actions can be safer than app input because they operate on compositor state. Even so, they must resolve a current target and produce evidence before becoming executable.

Alternative considered: treat all GUI actions as one category. That hides the difference between moving a known window and typing into whatever currently has focus.

### Deny risky targets by default

Terminal GUI automation, OpenCode/Codex windows, privilege prompts, permission dialogs, lockscreen contexts, and unknown sensitive targets must fail closed. The user can still use normal OpenCode shell/file tools through their existing permissions instead of GUI-driving a terminal.

Alternative considered: allow broad user override rules. Broad rules would make target drift and approval bypasses likely. If persistent allow rules are added later, they should be narrow and revocable.

### Evidence is part of the contract

Every route decision should include the request class, target metadata when available, selected route, rejection reason or next tool recommendation, and evidence path. Actions added later should include before/after observations.

Alternative considered: log only actual actions. That misses the most important safety data: why a request was refused or routed away from GUI automation.

## Risks / Trade-offs

- Over-classification can become busywork → Keep route categories small and focused on enforcement decisions.
- Tool availability can vary between sessions → Report unavailable structured routes without falling through to unsafe GUI input.
- Hyprland target metadata can drift → Re-resolve the target immediately before any future side-effecting action.
- Screenshots can expose sensitive content → Keep visual capture explicit and scoped; do not attach image bytes to evidence records.
- Route decisions are less exciting than automation → They lower the cost of adding safe execution later and prevent browser/input scope creep.

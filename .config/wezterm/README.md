# WezTerm Config

Lua configuration for WezTerm. The entrypoint stays thin and delegates settings to small modules by concern.

## Layout

- `wezterm.lua` builds and returns the final WezTerm config.
- `base.lua`, `platform.lua`, `layout.lua`, `fonts.lua`, `colors.lua`, `theme.lua`, `tabs.lua`, `status.lua`, `keys.lua`, and `mux.lua` hold the main config groups.
- `agent/` detects AI-agent activity and decorates tabs with state icons.
- `utils/` contains small text, time, performance, and benchmark helpers.
- `tests/` contains Lua specs for work-hour status and agent-deck detection.

## Behavior

- Status text includes date, week number, and work-hour state from the `first_login` user variable.
- Agent tab state can come from the WezTerm agent deck plugin or pane-text fallback detection.
- Keybinds use raw key codes where layout independence matters.
- The tab bar is bottom-aligned and styled from the shared theme palette.

## Validation

Run the focused specs after changing related logic:

```bash
lua .config/wezterm/tests/status_workhours_spec.lua
lua .config/wezterm/tests/agent_deck_detection_spec.lua
```

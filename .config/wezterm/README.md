# WezTerm Config

Lua configuration for WezTerm. The entrypoint stays thin and delegates settings to small modules by concern.

## Layout

- `wezterm.lua` builds and returns the final WezTerm config.
- `base.lua`, `platform.lua`, `layout.lua`, `fonts.lua`, `colors.lua`, `theme.lua`, `tabs.lua`, `status/`, `keys.lua`, and `mux.lua` hold the main config groups.
- `agent/` detects AI-agent activity and decorates tabs with state icons.
- `utils/` contains small text, time, performance, and benchmark helpers.
- `tests/` contains Lua specs for work-hour status, agent-deck integration, and Herdr tab titles.

## Behavior

- Work-hour status reads today's `first_login` cache every 10 seconds. Missing records trigger background macOS start-time detection; yesterday's start is never reused.
- Agent tab state comes from the WezTerm agent deck plugin.
- Keybinds use raw key codes where layout independence matters.
- The tab bar is bottom-aligned and styled from the shared theme palette.

## Validation

Run the focused specs after changing related logic:

```bash
lua .config/wezterm/tests/right_status_spec.lua
lua .config/wezterm/tests/workhours_spec.lua
lua .config/wezterm/tests/agent_deck_detection_spec.lua
lua .config/wezterm/tests/herdr_tab_title_spec.lua
```

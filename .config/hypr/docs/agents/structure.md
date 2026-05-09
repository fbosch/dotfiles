# Configuration Structure

- `hyprland.lua` - Primary Hyprland Lua entrypoint
- `animations.lua`, `appearance.lua`, `autostart.lua`, `base.lua`, `environment.lua`, `input.lua`, `keybinds.lua`, `monitors.lua`, `programs.lua` - Main Lua config modules
- `rules/` - Static and generated Lua rules
- `actions/` and `lib/` - Lua actions and shared helpers
- `runtime/` - Categorized shell helpers used by Lua config and UI integrations
- `legacy/hyprland-conf/` - Previous hyprlang config graph for reference
- `hyprlock.conf` - Screen lock settings
- `rules/window-state-selectors.lua` - Window state persistence selector source
- `legacy/hyprland-conf/window-state.conf` - Legacy selector source retained for rollback reference
- `hyprpaper.conf.example` - Wallpaper config template

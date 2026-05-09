# Hyprland Config

Hyprland window manager Lua configuration with custom keybinds, rules, and runtime helpers.

**Project:** [Hyprland](https://github.com/hyprwm/Hyprland)

**Configuration files:**
- `hyprland.lua` - Main Lua config entrypoint
- `keybinds.lua`, `autostart.lua`, `animations.lua`, `appearance.lua`, `input.lua`, `monitors.lua` - Core config modules
- `rules/` - Static and generated Lua window/workspace/layer rules
- `rules/window-state-selectors.lua` - Window state persistence selectors
- `hyprlock.conf` - Screen lock
- `hypridle.conf` - Idle behavior
- `legacy/hyprland-conf/` - Previous hyprlang setup retained for reference

**Runtime helpers:**
- `runtime/windows/` - Window state, minimize/restore, capture daemon, force-kill helpers
- `runtime/session/` - Session confirmation and exit helpers
- `runtime/profiles/` - Performance and gaming profile controls
- `runtime/gamescope/` - Gamescope profile and clipboard helpers
- `runtime/desktop/` - Desktop reset, Waybar, browser, layout, Hypridle, and icon helpers
- `runtime/capture/` - Screenshot and OCR helpers
- `runtime/startup/` - Startup workspace routing and UI launch helper

**Docs:**
- Agent guides: `structure.md`, `debugging.md`, `layer-rules.md`, `pitfalls.md`, `version.md`

**Assets:**
- Audio feedback: `bootup.ogg`, `warn.mp3`, `warn.ogg`

**Setup notes:**
- Create `hyprpaper.conf` from `hyprpaper.conf.example` for wallpaper config
- `rules/generated.lua` and `rules/window-state.lua` are auto-generated; don't edit directly
- `legacy/hyprland-conf/window-state.conf` is retained only for legacy rollback reference
- Validate changes: `hyprctl reload` and `hyprctl configerrors`
- Managed via Nix/Home Manager as part of dotfiles

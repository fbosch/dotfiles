# Hyprland Config

Hyprland window manager configuration with custom keybinds, rules, and support scripts.

**Configuration files:**
- `hyprland.conf` - Main config (sources other files)
- `keybinds.conf` - Keyboard shortcuts
- `rules.conf` / `generated-rules.conf` - Window rules and behaviors
- `animations.conf` - Animation settings
- `workspaces.conf` - Workspace layout
- `window-state.conf` - Window state management
- `hyprbars.conf` - Title bar plugin
- `hyprlock.conf` - Screen lock
- `hypridle.conf` - Idle behavior
- `hyprexpo.conf` - Workspace overview
- `monitors.conf.example` / `hyprpaper.conf.example` - Templates for local setup

**Scripts:**
- Window management: `cycle-windows.sh`, `window-switcher-wrapper.sh`, `window-state.sh`, `window-switcher-ags.sh`
- System confirmations: `confirm-exit.sh`, `confirm-restart.sh`, `confirm-shutdown.sh`, `confirm-suspend.sh`
- System utilities: `screenshot.sh`, `toggle-hypridle.sh`, `toggle-night-light.sh`, `toggle-performance-mode.sh`, `launch-browser.sh`
- Waybar integration: `waybar-lib.sh`, `waybar-toggle-smart.sh`, `waybar-edge-monitor.sh`
- Monitoring/setup: `wait-for-monitors.sh`, `reset-desktop.sh`, `nerd-icon-gen.sh`, `window-capture-daemon.sh`, `switch-layout.sh`

**Docs:**
- Agent guides: `structure.md`, `debugging.md`, `layer-rules.md`, `pitfalls.md`, `version.md`

**Assets:**
- Audio feedback: `bootup.ogg`, `warn.mp3`, `warn.ogg`

**Setup notes:**
- Create `monitors.conf` from `monitors.conf.example` for your display setup
- Create `hyprpaper.conf` from `hyprpaper.conf.example` for wallpaper config
- `generated-rules.conf` is auto-generated; don't edit directly
- Validate changes: `hyprctl reload` and `hyprctl configerrors`
- Managed via Nix/Home Manager as part of dotfiles

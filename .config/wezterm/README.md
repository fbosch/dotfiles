# Wezterm Config

Wezterm terminal configuration with modular Lua setup for theming, keybinds, and UI customization.

**Project:** [Wezterm](https://wezfurlong.org/wezterm/)

**Configuration modules (wezterm.lua imports):**
- `base.lua` - Core settings (OpenGL frontend, performance, status updates, shell processes)
- `colors.lua` - Color scheme (zenwritten_dark) and tab bar colors
- `agent/deck.lua` - AI agent status integration via wezterm-agent-deck plugin
- `theme.lua` - Shared theme palette used by WezTerm modules
- `fonts.lua` - Font stack with fallbacks (Zenbones Brainy, JetBrains Mono, Nerd Fonts)
- `keys.lua` - Keyboard keybindings (raw key codes for layout independence)
- `layout.lua` - Window decorations, padding, and startup behavior
- `mux.lua` - Unix mux domain setup
- `platform.lua` - Platform-specific settings
- `status.lua` - Status bar with date/time, week number, and work hours tracking
- `tabs.lua` - Tab bar configuration (bottom position, custom formatting)

**Utilities:**
- `utils/text.lua` - Text manipulation helpers
- `utils/time.lua` - Time calculation for tracking work hours

**Assets:**
- `scanlines.png` - Visual effect asset

**Notes:**
- Modular architecture: each concern is isolated in its own file
- Status bar includes work hours calculation based on `first_login` user variable
- Tab titles show wezterm-agent-deck activity icons for detected agent panes
- Includes fallback detection from pane text so OpenCode in Neovim terminal panes still shows state
- Agent deck icons use Nerd Font glyphs (with Unicode fallback)
- Tab icons are colorized by agent state (working/waiting/idle/inactive)
- Tab bar positioned at bottom with custom formatting
- Uses raw key codes for keybinds (keyboard layout independent)
- OpenGL frontend with 120fps max, Wayland enabled on Linux
- Managed via GNU Stow as part of dotfiles

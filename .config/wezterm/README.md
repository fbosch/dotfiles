# Wezterm Config

Wezterm terminal configuration with modular Lua setup for theming, keybinds, and UI customization.

**Project:** [Wezterm](https://wezfurlong.org/wezterm/)

**Configuration modules (wezterm.lua imports all):**
- `lua/base.lua` - Core settings (WebGPU, performance, status updates, shell processes)
- `lua/colors.lua` - Color scheme (zenwritten_dark) and tab bar colors
- `lua/fonts.lua` - Font stack with fallbacks (Zenbones Brainy, JetBrains Mono, Nerd Fonts)
- `lua/keys.lua` - Keyboard keybindings (raw key codes for layout independence)
- `lua/layout.lua` - Window decorations, padding, and startup behavior
- `lua/platform.lua` - Platform-specific settings
- `lua/status.lua` - Status bar with date/time, week number, and work hours tracking
- `lua/tabs.lua` - Tab bar configuration (bottom position, custom formatting)

**Utilities:**
- `lua/utils/text.lua` - Text manipulation helpers
- `lua/utils/time.lua` - Time calculation for tracking work hours

**Assets:**
- `scanlines.png` - Visual effect asset

**Notes:**
- Modular architecture: each concern is isolated in its own file
- Status bar includes work hours calculation based on `first_login` user variable
- Tab bar positioned at bottom with custom formatting
- Uses raw key codes for keybinds (keyboard layout independent)
- WebGPU frontend with 120fps max, Wayland enabled on Linux
- Managed via Nix/Home Manager as part of dotfiles

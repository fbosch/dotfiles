# Hyprland Quick Rule

Quick apply window rules to Hyprland windows using common profiles.

## Features

- Select any Hyprland window using `hyprprop`
- Choose from predefined rule profiles based on common use cases
- Automatically generates and applies window rules
- Choose which selector to match on (class, initial_class, title, initial_title)
- Rules are written to `~/.config/hypr/generated-rules.conf`

## Requirements

- Hyprland window manager
- `hyprprop` - Tool for selecting and inspecting Hyprland windows

## Usage

1. Launch the extension
2. Click on any Hyprland window when prompted
3. Choose which property to match on from the dropdown (class, initial_class, title, or initial_title)
4. Select a rule profile from the list
5. The rule is automatically applied and Hyprland config is reloaded

## Available Profiles

### Window Positioning
- **Floating (Small)** - Float window with small size (360x620)
- **Floating (Medium)** - Float window with medium size (750x900)
- **Floating (Large)** - Float window with large size (900x900)
- **Floating (Centered)** - Float window and center it
- **Floating + Pinned** - Float and pin to all workspaces
- **Floating + Pinned (Corner)** - Float, pin, and position in bottom-right corner

### Display Modes
- **Fullscreen** - Force fullscreen mode
- **Clean Fullscreen** - Fullscreen with no decorations (like remote desktop)
- **Picture-in-Picture** - Float, pin, with slide animation (like browser PiP)

### Appearance
- **No Title Bar** - Hide hyprbars title bar
- **No Bar + Float** - Hide title bar and float window
- **No Animations** - Disable animations (useful for games)
- **Borderless Window** - Remove borders and rounding
- **No Shadow** - Disable window shadow
- **Force Opaque** - Override opacity to 100% (disable transparency)

### Special Profiles
- **Gaming Profile** - No animations, no bar, no borders, fullscreen (like Steam games)
- **Utility Window** - Float, pin, no animations, positioned at corner (like system tools)
- **Dialog Window** - Float, pin, no animations, no bar (like system dialogs)
- **File Manager** - Float with no animations (like Nemo)

### Persistence
- **Save Window State** - Remember window size and position over time (saves to window-state.conf)

## Keybindings

- **Enter** - Apply selected rule profile
- **⌘P** - Preview rules for selected profile
- **⌘R** - Retry window selection

## Configuration

### Generated Rules

Generated rules are written to `~/.config/hypr/generated-rules.conf`. Make sure your `~/.config/hypr/rules.conf` includes this file:

```
source = ~/.config/hypr/generated-rules.conf
```

### Window State Persistence

When using the "Save Window State" profile, the window matcher is appended to `~/.config/hypr/window-state.conf`. This file is used by window state persistence scripts to remember window size and position across restarts.

The extension checks for duplicates before adding entries to prevent cluttering the file.

## License

MIT

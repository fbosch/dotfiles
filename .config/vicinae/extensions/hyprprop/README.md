# Hyprprop Extension for Vicinae

View Hyprland window information directly in Vicinae.

## Features

- Select any Hyprland window and view its properties
- Display comprehensive window information including:
  - Basic info (title, class, PID)
  - Window state (floating, pinned, fullscreen)
  - Position and size
  - Workspace and monitor
  - XWayland status
- Copy window class, address, or full JSON data to clipboard
- Formatted markdown display with metadata sidebar

## Requirements

- Hyprland window manager
- `hyprprop` utility installed

## Installation

This extension is part of the local dotfiles collection.

## Usage

1. Launch Vicinae
2. Search for "View Window Information" or "hyprprop"
3. Click to select a window (hyprprop will launch)
4. View the formatted window information

## Keyboard Shortcuts

- `Cmd+R`: Retry window selection
- `Cmd+C`: Copy window class
- `Cmd+Shift+C`: Copy window address
- `Cmd+Shift+A`: Copy all info as JSON
- `Cmd+W`: Close window

## Development

```bash
# Install dependencies
npm install

# Build extension
npm run build

# Lint code
npm run lint

# Format code
npm run format
```

## License

MIT

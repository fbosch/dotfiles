# Hyprprop

View Hyprland window information directly in Vicinae.

## Command

`View Window Information` launches `hyprprop`, lets you select a window, and shows a formatted summary of the selected client's properties.

Displayed data includes title, class, PID, workspace, monitor, position, size, floating/pinned/fullscreen state, and XWayland status when available.

## Requirements

- Hyprland.
- `hyprprop` on `PATH`.

## Usage

1. Run `View Window Information` from Vicinae.
2. Select a window when `hyprprop` prompts.
3. Copy the specific field you need from the action panel.

## Keyboard Shortcuts

- `Cmd+R` retries window selection.
- `Cmd+C` copies the window class.
- `Cmd+Shift+C` copies the window address.
- `Cmd+Shift+A` copies all info as JSON.
- `Cmd+W` closes the view.

## Development

```bash
pnpm install
pnpm run dev
pnpm run lint
pnpm run build
```

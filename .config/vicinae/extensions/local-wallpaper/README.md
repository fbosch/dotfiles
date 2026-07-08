# Local Wallpaper

Vicinae extension for browsing local wallpapers and applying them through `hyprpaper`.

## Command

`Change Wallpaper` scans the configured wallpaper directory, shows a searchable grid, and applies selected images to Hyprland monitors.

## Requirements

- Hyprland.
- `hyprpaper` on `PATH`.
- A local wallpaper directory with supported image files.

Per-monitor fit modes require hyprpaper v0.8+. Older hyprpaper versions can still set per-monitor wallpapers, but individual monitor fit modes fall back to the default behavior.

## Preferences

- Wallpapers directory, default `~/Pictures/Wallpapers`.
- Hyprpaper config path, default `~/.config/hypr/hyprpaper.conf`.
- File extensions, default `png,jpg,jpeg,webp,jxl`.
- Default sort order.

## Actions

- `Enter` opens the wallpaper preview.
- `Cmd+S` applies the wallpaper.
- `Cmd+O` opens the image in the default viewer.
- `Cmd+C` copies the file path.
- `Cmd+P` toggles favorite state.
- `Cmd+R` refreshes the list.
- `Ctrl+X` moves the file to trash.

The action panel also exposes monitor and fill-mode choices for applying to all monitors or one monitor.

## How It Applies Wallpapers

- Monitors are read from `hyprctl monitors -j`.
- The extension writes compatible `hyprpaper.conf` syntax for the detected hyprpaper version.
- It preserves existing multi-monitor assignments where practical.
- It restarts or reloads hyprpaper after writing the config.

## Troubleshooting

- Wallpapers not listed: check the directory path, file extensions, and Vicinae filesystem access.
- Wallpaper not applied: check `hyprpaper` is installed and the configured file is writable.
- Monitor mismatch: compare the selected monitor names with `hyprctl monitors -j`.
- Fit mode ignored: check `hyprpaper --version`; per-monitor `fit_mode` needs v0.8+.

## Development

```bash
pnpm install
pnpm run dev
pnpm run lint
pnpm run test
pnpm run build
```

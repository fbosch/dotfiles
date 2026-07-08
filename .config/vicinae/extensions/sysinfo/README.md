# System Info

Vicinae extension for viewing Linux system information in a single visual summary.

## Command

`Show System Info` displays OS, kernel, architecture, uptime, CPU, memory, storage, GPU, and display details where the host exposes them.

## Data Sources

- Linux `/proc` files for core system data.
- Standard system commands where needed.
- `lspci` for GPU information when available.
- Hyprland or X11 data for connected displays when available.

Some fields are absent on VMs, containers, headless machines, or hosts missing optional commands.

## Actions

- `Cmd+R` refreshes system information.
- `Cmd+C` copies the hostname.
- `Cmd+Shift+C` copies OS information.
- `Cmd+Shift+A` copies all info as markdown.

## Preferences

- Show distribution logo.
- Auto-refresh interval: disabled, 5 seconds, 10 seconds, 30 seconds, or 1 minute.

## Requirements

- Linux with `/proc`.
- Optional `lspci` for GPU information.
- Optional Hyprland or X11 for display information.

## Development

```bash
pnpm install
pnpm run dev
pnpm run lint
pnpm run build
```

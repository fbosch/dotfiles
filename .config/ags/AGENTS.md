# AGS Configuration - Agent Guide

AGS (Aylur's GTK Shell) configuration for Hyprland UI elements using bundled mode architecture.

## Essentials

- Bundled mode only: all components run as a single process via `config-bundled.tsx` and `start-daemons.sh`.
- Styling is inline via `app.start({ css: ... })` or `app.apply_css()`; avoid external CSS files.
- Type definitions: `.config/ags/@girs/` is auto-generated; regenerate with `ags types` on new systems.

## Commands

- `ags types` (regenerate GObject typings)

## More Guidance

- [Architecture and components](docs/agents/architecture.md)
- [Commands and setup](docs/agents/commands-setup.md)
- [TSX/JSX conventions](docs/agents/tsx-jsx.md)
- [Styling and design system](docs/agents/styling.md)
- [Hyprland integration](docs/agents/hyprland-integration.md)
- [GJS/GLib integration](docs/agents/gjs-glib.md)
- [Daemon lifecycle](docs/agents/daemon.md)
- [Troubleshooting](docs/agents/troubleshooting.md)
- [Best practices](docs/agents/best-practices.md)
- [Resources](docs/agents/resources.md)

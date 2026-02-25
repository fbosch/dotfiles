# AGENTS

AGS (Aylur's GTK Shell) configuration for Hyprland UI, using bundled mode.

## Essentials

- Bundled mode only; keep entrypoint wiring consistent with `config-bundled.tsx` and `start-daemons.sh`.
- Keep styling inline through AGS CSS APIs (`app.start({ css: ... })` / `app.apply_css()`), not external theme files.
- Do not edit `.config/ags/@girs/` manually; regenerate typings when needed.

## Commands

- `ags types`

## References

- [AGS guide (upstream docs)](docs/guide/TOC.md)
- [Architecture and components](docs/agents/architecture.md)
- [Commands and setup](docs/agents/commands-setup.md)
- [TSX/JSX conventions](docs/agents/tsx-jsx.md)
- [Styling and design system](docs/agents/styling.md)
- [Hyprland integration](docs/agents/hyprland-integration.md)
- [GJS/GLib integration](docs/agents/gjs-glib.md)
- [Daemon lifecycle](docs/agents/daemon.md)
- [Troubleshooting](docs/agents/troubleshooting.md)

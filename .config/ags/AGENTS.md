# AGENTS

AGS (Aylur's GTK Shell) configuration for Hyprland UI, using bundled mode.

## Essentials

- Bundled mode only; keep entrypoint wiring consistent with `config-bundled.tsx` and `start-daemons.sh`.
- Keep styling inline through AGS CSS APIs (`app.start({ css: ... })` / `app.apply_css()`), not external theme files.
- Do not edit `.config/ags/@girs/` manually; regenerate typings when needed.

## Commands

- `ags types`
- `bash scripts/benchmark/run-benchmarks.sh calendar-widget` - benchmark only the Calendar Widget slice.
- `bash scripts/benchmark/run-benchmarks.sh window-switcher` - benchmark only the Window Switcher slice.
- `bash scripts/benchmark/run-benchmarks.sh components` - benchmark bundled non-calendar component toggles.
- `bash scripts/benchmark/run-benchmarks.sh memory` - run only the legacy bundled memory loop.
- `bash scripts/benchmark/run-benchmarks.sh all` - run the full benchmark suite.

Benchmark target can also be set with `BENCH_TARGET`; positional target wins. Keep targeted runs focused when investigating one bundled component.

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

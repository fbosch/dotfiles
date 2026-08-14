# AGENTS

AGS (Aylur's GTK Shell) configuration for Hyprland UI.

## Essentials

- Keep all GTK surfaces in `config-bundled.tsx` (`ags-bundled`), started by
  `start-daemons.sh` at login. Keep task-oriented system windows as lazy
  modules behind `services/utility-manager.ts`; do not import them from the
  entry point or make shell components depend on their globals.
- Keep styling inline through AGS CSS APIs (`app.start({ css: ... })` / `app.apply_css()`), not external theme files.
- For AGS surfaces that mirror `design-system/src/components/`, match the component source as the visual contract; do not depend on Storybook stories at runtime.
- Compose surfaces from existing atomic components when their semantics and interaction model fit. Prefer expanding shared primitives for recurring behavior over duplicating GTK construction and styling; use native widgets for distinct custom controls.
- Every translucent shell surface, including nested menus and popovers, must use the shared Gaming profile opacity state and become fully opaque with its parent surface.
- Do not edit `.config/ags/@girs/` manually; regenerate typings when needed.

## Commands

- `ags types`
- `pnpm test` - run pure AGS service tests.
- `pnpm test:coverage` - write LCOV coverage to `/tmp/ags-coverage`.
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

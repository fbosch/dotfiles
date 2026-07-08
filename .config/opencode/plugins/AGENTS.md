# OpenCode Plugins

Local OpenCode server and TUI plugins.

## Essentials

- Keep each non-trivial plugin in its own directory with its own `.fallowrc.json`.
- Run Fallow against the specific plugin config before finishing plugin changes.
- Keep root-level plugin files only for actual OpenCode plugin entrypoints.
- Put tests, benchmarks, engines, helpers, and fixtures inside the owning plugin directory so OpenCode does not auto-load them as plugins.
- TUI plugin entry files must have unique filenames; do not use repeated `index.ts` or `index.tsx` entrypoints.
- For local TUI plugins, update `.config/opencode/tui.json` when moving or renaming the entry file.
- After TUI config or plugin entrypoint changes, restart OpenCode to load them.

## Validation

- Use the plugin-specific Fallow script or direct `fallow --config <plugin>/.fallowrc.json` command.
- For `prompt-enhancements`, run `bun run test:typos`, `bun run bench:typos` after performance changes, and a Bun build check for `prompt-enhancements/prompt-enhancements.tsx`.

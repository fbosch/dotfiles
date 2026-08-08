# AGENTS

Personal dotfiles managed with GNU Stow across macOS and Linux.

## Preferences

- Prefer event-based systems over polling when both are viable.
- Planning tasks should be vertical slices with observable outcomes, not horizontal layers.

## Essentials

- Do not edit generated state/lock files (e.g. `lazy-lock.json`, AGS GIR typings, Fish auto-generated dirs).
- Follow symlinks when reading docs.
- Dotfiles repo root is `~/dotfiles`.
- Canonical skills live in `.agents/skills/` and are mirrored under `.config/{opencode,codex,github,claude}/skills`.

## OpenSpec

- Use `<domain>-<behavior>` when a domain disambiguates the capability, such as `hypr-custom-layout-ordering`, `ags-calendar-widget`, or `neovim-context-mcp-bridge`.
- Keep each change as one cross-cutting vertical slice when it affects multiple areas.

## Commands

- `stow .`
- `stow -n .`
- Add and run tests through `devenv test`.

## OpenCode Plugins

- Local plugins live in `.config/opencode/plugins/` and are auto-loaded by OpenCode; npm plugins are configured in `opencode.json`.
- Each plugin entry file **must have a unique filename** (not `index.ts`). OpenCode deduplicates plugins by filename only, so multiple `index.ts` files collapse to one.
- `@opencode-ai/plugin` must be a `peerDependency`, not `devDependency` — the published package ships empty `dist/`; opencode provides it at runtime.

## References

- [Common operations](docs/agents/operations.md)
- [ADRs](docs/adr/)
- [Neovim Lua style](docs/agents/nvim-lua.md)
- [Fish shell style](docs/agents/fish-shell.md)
- [File organization](docs/agents/file-organization.md)
- [Theme and consistency](docs/agents/theme.md)
- [Platform notes](docs/agents/platform.md)
- [Git workflow and validation](docs/agents/git-workflow.md)

# AGENTS

Personal dotfiles managed with GNU Stow across macOS and Linux.

## Preferences

- Prefer event-based systems over polling when both are viable.

## Essentials

- Do not edit generated state/lock files (e.g. `lazy-lock.json`, AGS GIR typings, Fish auto-generated dirs).
- Follow symlinks when reading docs.
- Dotfiles repo root is `~/dotfiles`.
- Canonical skills live in `.agents/skills/` and are mirrored under `.config/{opencode,codex,github,claude}/skills`.

## Commands

- `stow .`
- `stow -n .`

## OpenCode Plugins

- Local plugins live in `.config/opencode/plugins/` and are auto-loaded by OpenCode; npm plugins are configured in `opencode.json`.
- Each plugin entry file **must have a unique filename** (not `index.ts`). OpenCode deduplicates plugins by filename only, so multiple `index.ts` files collapse to one.
- `@opencode-ai/plugin` must be a `peerDependency`, not `devDependency` — the published package ships empty `dist/`; opencode provides it at runtime.
- RTK's official OpenCode hook lives at `.config/opencode/plugins/rtk.ts`.
- The `rtk` plugin only rewrites `bash`/`shell` tool commands. `host_exec` is excluded because its strict allowlist rejects the `rtk` prefix.

## References

- [Common operations](docs/agents/operations.md)
- [Neovim Lua style](docs/agents/nvim-lua.md)
- [Fish shell style](docs/agents/fish-shell.md)
- [File organization](docs/agents/file-organization.md)
- [Theme and consistency](docs/agents/theme.md)
- [Platform notes](docs/agents/platform.md)
- [Git workflow and validation](docs/agents/git-workflow.md)

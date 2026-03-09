# AGENTS

Personal dotfiles managed with GNU Stow across macOS and Linux.

## Essentials

- Do not edit generated state/lock files: `lazy-lock.json`, `.config/nvim/.{sessions,undo,backup}/`, `.config/fish/{fish_variables,completions,conf.d,functions}/`, `.config/lazygit/state.yml`, `.config/ags/@girs/`.
- Follow symlinks when reading docs.
- Canonical skills live in `.agents/skills/` and are mirrored under `.config/{opencode,codex,github,claude}/skills`.

## Commands

- `stow .`
- `stow -n .`

## OpenCode Plugins

- Local plugins live in `.config/opencode/plugins/` and are registered in `opencode.json`.
- Each plugin entry file **must have a unique filename** (not `index.ts`). OpenCode deduplicates plugins by filename only, so multiple `index.ts` files collapse to one.
- `@opencode-ai/plugin` must be a `peerDependency`, not `devDependency` — the published package ships empty `dist/`; opencode provides it at runtime.
- The `rtk` plugin only rewrites `bash` tool commands. `host_exec` is excluded because its strict allowlist rejects the `rtk` prefix.

## References

- [Common operations](docs/agents/operations.md)
- [Neovim Lua style](docs/agents/nvim-lua.md)
- [Fish shell style](docs/agents/fish-shell.md)
- [File organization](docs/agents/file-organization.md)
- [Theme and consistency](docs/agents/theme.md)
- [Platform notes](docs/agents/platform.md)
- [Git workflow and validation](docs/agents/git-workflow.md)

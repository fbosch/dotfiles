# AGENTS

Personal dotfiles managed with GNU Stow across macOS and Linux.

## Essentials

- Do not edit generated state/lock files: `lazy-lock.json`, `.config/nvim/.{sessions,undo,backup}/`, `.config/fish/{fish_variables,completions,conf.d,functions}/`, `.config/lazygit/state.yml`, `.config/ags/@girs/`.
- Follow symlinks when reading docs.
- Canonical skills live in `.agents/skills/` and are mirrored under `.config/{opencode,codex,github,claude}/skills`.

## Commands

- `stow .`
- `stow -n .`

## References

- [Common operations](docs/agents/operations.md)
- [Neovim Lua style](docs/agents/nvim-lua.md)
- [Fish shell style](docs/agents/fish-shell.md)
- [File organization](docs/agents/file-organization.md)
- [Theme and consistency](docs/agents/theme.md)
- [Platform notes](docs/agents/platform.md)
- [Git workflow and validation](docs/agents/git-workflow.md)

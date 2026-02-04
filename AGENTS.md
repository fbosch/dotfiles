# Dotfiles Repository - Agent Guide

Personal dotfiles managed with GNU Stow for symlink management across macOS and Linux.

## Essentials

- Do not edit auto-generated files:
  - `lazy-lock.json` (Lazy.nvim lockfile)
  - `.config/nvim/.sessions/`, `.config/nvim/.undo/`, `.config/nvim/.backup/` (Neovim state)
  - `.config/fish/{fish_variables,completions,conf.d,functions}/` (Fish shell state)
  - `.config/lazygit/state.yml` (Lazygit state)
  - `.config/ags/@girs/` (AGS TypeScript type definitions; regenerate with `ags types`)
- When reading docs, check for symlinks and follow them to source material.

## Package manager

NixOS/Home Manager (managed in external repo)
External repo: https://github.com/fbosch/nixos (usually at `~/nixos`)

## Commands

- `stow .`
- `stow -n .`

## Skills

- Canonical skills live in `.agents/skills/`
- `.agents/skills/` is symlinked to `.opencode/skill`, `.config/opencode/skills`, `.config/codex/skills`, `.config/github/skill`, and `.config/claude/skills`

## More Guidance

- [Common operations](docs/agents/operations.md)
- [Neovim Lua style](docs/agents/nvim-lua.md)
- [Fish shell style](docs/agents/fish-shell.md)
- [File organization](docs/agents/file-organization.md)
- [Theme and consistency](docs/agents/theme.md)
- [Platform notes](docs/agents/platform.md)
- [Git workflow and validation](docs/agents/git-workflow.md)

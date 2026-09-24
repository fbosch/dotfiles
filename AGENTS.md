# AGENTS

Personal dotfiles managed with GNU Stow across macOS and Linux.

## Preferences

- Prefer event-based systems over polling when both are viable.
- Planning tasks should be vertical slices with observable outcomes, not horizontal layers.
- Add a brief intent comment when code preserves a non-obvious constraint, ordering/lifecycle requirement, workaround, performance tradeoff, or fallback whose reason is not clear from names, types, and local control flow; do not restate obvious mechanics.

## Essentials

- Do not edit generated state/lock files (e.g. `nvim-pack-lock.json`, AGS GIR typings, Fish auto-generated dirs).
- Follow symlinks when reading docs.
- Dotfiles repo root is `~/dotfiles`.
- Shared skills live in `.agents/skills/` and are mirrored under `.config/{codex,github,claude}/skills`.
- Dotfiles-specific Pi skills live in `.pi/skills/`.

## OpenSpec

- Use `<domain>-<behavior>` when a domain disambiguates the capability, such as `hypr-custom-layout-ordering`, `ags-calendar-widget`, or `neovim-context-mcp-bridge`.
- Keep each change as one cross-cutting vertical slice when it affects multiple areas.

## Commands

- `just stow-apply`
- `just stow-check`
- Add and run tests through `devenv test`.
- Run Caliper skill evaluations through `scripts/caliper-skill-eval.sh`; do not invoke `caliper run` directly.

## Pi Extensions

- Extensions in `.pi/agent/extensions/` are auto-discovered from the Stow-linked `~/.pi/agent/extensions/`; use `/reload` after changes.

## OpenCode Fallback

- OpenCode is retained as a near-stock fallback; keep its configuration limited to `.config/opencode/opencode.jsonc`.

## References

- [Common operations](docs/agents/operations.md)
- [ADRs](docs/adr/)
- [Neovim Lua style](docs/agents/nvim-lua.md)
- [Fish shell style](docs/agents/fish-shell.md)
- [File organization](docs/agents/file-organization.md)
- [Theme and consistency](docs/agents/theme.md)
- [Platform notes](docs/agents/platform.md)
- [Git workflow and validation](docs/agents/git-workflow.md)

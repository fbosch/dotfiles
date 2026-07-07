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
- [ADRs](docs/adr/)
- [Neovim Lua style](docs/agents/nvim-lua.md)
- [Fish shell style](docs/agents/fish-shell.md)
- [File organization](docs/agents/file-organization.md)
- [Theme and consistency](docs/agents/theme.md)
- [Platform notes](docs/agents/platform.md)
- [Git workflow and validation](docs/agents/git-workflow.md)


<!-- headroom:rtk-instructions -->
# RTK (Rust Token Killer) - Token-Optimized Commands

When running shell commands, **always prefix with `rtk`**. This reduces context
usage by 60-90% with zero behavior change. If rtk has no filter for a command,
it passes through unchanged — so it is always safe to use.

## Key Commands
```bash
# Git (59-80% savings)
rtk git status          rtk git diff            rtk git log

# Files & Search (60-75% savings)
rtk ls <path>           rtk read <file>         rtk grep <pattern>
rtk find <pattern>      rtk diff <file>

# Test (90-99% savings) — shows failures only
rtk pytest tests/       rtk cargo test          rtk test <cmd>

# Build & Lint (80-90% savings) — shows errors only
rtk tsc                 rtk lint                rtk cargo build
rtk prettier --check    rtk mypy                rtk ruff check

# Analysis (70-90% savings)
rtk err <cmd>           rtk log <file>          rtk json <file>
rtk summary <cmd>       rtk deps                rtk env

# GitHub (26-87% savings)
rtk gh pr view <n>      rtk gh run list         rtk gh issue list

# Infrastructure (85% savings)
rtk docker ps           rtk kubectl get         rtk docker logs <c>

# Package managers (70-90% savings)
rtk pip list            rtk pnpm install        rtk npm run <script>
```

## Rules
- In command chains, prefix each segment: `rtk git add . && rtk git commit -m "msg"`
- For debugging, use raw command without rtk prefix
- `rtk proxy <cmd>` runs command without filtering but tracks usage
<!-- /headroom:rtk-instructions -->

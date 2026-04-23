# AGENTS

Internal Bun/TypeScript helpers for Fish functions.

## Purpose

- Keep `.config/fish/functions/*.fish` as thin UX/orchestration wrappers.
- Keep parsing, transforms, and data mutation logic in `.config/fish/libexec/**/*.ts`.

## Organization

- Use one level of domain grouping when a helper area has 3+ related scripts.
- Current subdirectories:
  - `azure/` for Azure DevOps and workitem helpers
  - `opencode/` for OpenCode and related workflow helpers
  - `shared/` for cross-domain utilities
  - `nix/` for flake and other Nix-related helpers

## Runtime and Dependencies

- Runtime: `bun`.
- Dependencies are pinned in `package.json` and `bun.lock`.
- Fish wrappers call helpers with `bun --install=auto --cwd .config/fish/libexec`.
- When implementing or changing Bun-based helpers, load the `Bun` skill for Bun-specific runtime, package-manager, and scripting guidance.

## Coding Conventions

- Write deterministic CLI helpers: explicit args, machine-readable stdout, errors to stderr.
- Return non-zero exit codes on failure.
- Prefer native Bun/TS first; add libraries only when they reduce complexity.
- Use `neverthrow` for non-trivial I/O/process error boundaries.
- Use `zod` for env/argument/config parsing and external JSON shape validation.
- Use `ts-pattern` only when branching becomes structural/exhaustive.
- Use `es-toolkit` only when shared utility patterns appear across helpers.
- Use `p-limit` only for bounded async concurrency when work units are independent.
- Do not use `p-limit` for shared mutable resources (for example one lockfile path).
- Use `c12` only when a helper genuinely needs layered config loading (defaults + file + env);
  avoid it for one-off scripts with 1-3 env vars.

## Validation

- `biome check .config/fish/libexec`
- `bunx tsc -p .config/fish/libexec/tsconfig.json`

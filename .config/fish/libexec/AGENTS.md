# AGENTS

Internal Bun/TypeScript helpers for Fish functions.

## Purpose

- Keep `.config/fish/functions/*.fish` as thin UX/orchestration wrappers.
- Keep parsing, transforms, and data mutation logic in `.config/fish/libexec/*.ts`.

## Runtime and Dependencies

- Runtime: `bun`.
- Dependencies are pinned in `package.json` and `bun.lock`.
- Fish wrappers call helpers with `bun --install=auto --cwd .config/fish/libexec`.

## Coding Conventions

- Write deterministic CLI helpers: explicit args, machine-readable stdout, errors to stderr.
- Return non-zero exit codes on failure.
- Prefer native Bun/TS first; add libraries only when they reduce complexity.
- Use `neverthrow` for non-trivial I/O/process error boundaries.
- Use `ts-pattern` only when branching becomes structural/exhaustive.
- Use `es-toolkit` only when shared utility patterns appear across helpers.

## Validation

- `biome check .config/fish/libexec`
- `bunx tsc -p .config/fish/libexec/tsconfig.json`

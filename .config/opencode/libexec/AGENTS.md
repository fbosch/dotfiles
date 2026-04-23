# AGENTS

Internal Bun/TypeScript helpers for OpenCode command and script workflows.

## Purpose

- Keep `.config/opencode/scripts/*` as thin launch wrappers.
- Keep parsing, transforms, API orchestration, and payload shaping in `.config/opencode/libexec/**/*.ts`.

## Organization

- Use one level of domain grouping when a helper area has 3+ related scripts.
- Current subdirectories:
  - `azure/` for Azure DevOps helpers used by OpenCode commands
  - `shared/` for local OpenCode helper utilities

## Runtime and Dependencies

- Runtime: `bun`.
- Dependencies are pinned in `package.json` and `bun.lock`.
- OpenCode script wrappers call helpers with `bun --cwd .config/opencode/libexec`.
- `bunfig.toml` is the source of truth for Bun install/runtime defaults for this helper runtime.
- When implementing or changing Bun-based helpers, load the `Bun` skill for Bun-specific runtime, package-manager, and scripting guidance.

## Coding Conventions

- Write deterministic CLI helpers: explicit args, machine-readable stdout, errors to stderr or `ERROR:` payloads when the caller contract requires stdout.
- Return non-zero exit codes on failure unless the calling OpenCode command contract explicitly expects `ERROR:` text on stdout.
- Prefer native Bun/TS first; add libraries only when they reduce complexity.
- Use `neverthrow` for non-trivial I/O/process error boundaries.
- Use `zod` for env/argument/config parsing and external JSON shape validation.
- Use `ts-pattern` only when branching becomes structural/exhaustive.
- Use `es-toolkit` only when shared utility patterns appear across helpers.
- Use `p-limit` only for bounded async concurrency when work units are independent.

## Validation

- `bunx tsc -p .config/opencode/libexec/tsconfig.json`

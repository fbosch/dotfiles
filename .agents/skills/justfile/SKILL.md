---
name: justfile
description: Use when a repository contains a `justfile` or `.justfile` and work should flow through `just` recipes instead of ad-hoc shell commands. Covers recipe discovery, execution, debugging, and concise recipe authoring/refactoring for repeatable project tasks.
---

# Justfile

When a repository has a `justfile`, treat it as the task entrypoint for build/test/dev automation.

## What To Do

1. Detect task runner files: prefer `justfile`, then `.justfile`.
2. Discover recipes first: use `just-mcp` via toolbox when available; fallback to `just --list`.
3. Execute existing recipes rather than rewriting shell pipelines.
4. If a needed workflow is missing, add a recipe instead of repeating ad-hoc commands.
5. Keep recipe changes small, composable, and project-scoped.

## MCP/Toolbox Integration

- Prefer `toolbox_execute` with `just-mcp_list_recipes` for discovery.
- Use `just-mcp_get_recipe_info` for per-recipe docs/signatures.
- Use `just-mcp_validate_justfile` after recipe edits.
- Use `just-mcp_run_recipe` for execution only when runtime parity is expected; fallback to `just <recipe>` when container/runtime tool availability differs.
- Keep recipe docs in `#` comment lines above recipes for maximum parser compatibility; avoid relying on `[doc("...")]` if current `just-mcp` parser cannot parse attributes.

## Edit Decision Rule

1. One-off local investigation: run a direct command.
2. Repeated workflow or team touchpoint: add/update a `just` recipe.
3. Existing recipe is close: extend it rather than creating a near-duplicate.
4. New recipe changes shared behavior: keep defaults safe and non-destructive.

## What You Can Do When `justfile` Exists

- Run common project workflows (`just test`, `just lint`, `just build`, etc.).
- Execute parameterized tasks (`just release 1.2.3`, `just deploy prod`).
- Chain workflows through dependencies instead of manual command ordering.
- Centralize repeated setup tasks (tool install, codegen, local env bootstrap).
- Refactor repeated shell snippets into named recipes for discoverability.
- Add ergonomic aliases and defaults that reduce command drift across teammates.

## Authoring Rules

- Do not treat `just` as `make`; use valid `just` syntax only.
- Keep recipes idempotent when practical and avoid destructive default behavior.
- Prefer clear recipe names and explicit parameters over hidden env coupling.
- Use private/helper recipes for internals and public recipes for team entrypoints.
- Preserve existing style, shell choice, and variable conventions in the file.

## Never Do This

- Never bypass an existing recipe for a repeatable task; fix the recipe instead.
- Never make a destructive recipe the default entrypoint; require explicit invocation.
- Never rely on undocumented required env vars; name them and fail clearly when absent.
- Never duplicate near-identical recipes with copied command bodies; factor shared helpers.

## Debugging Recipe Failures

1. Re-run with `just-mcp_run_recipe` and capture the MCP error.
2. Re-run directly (`just <recipe>`) to isolate container/runtime differences.
3. Inspect recipes/signatures with `just-mcp_list_recipes`/`just-mcp_get_recipe_info` (fallback `just --list`).
4. Validate assumptions about env vars, working directory, and shell semantics.
5. If needed, split complex one-liners into helper recipes for clearer failures.

## Failure Routing Matrix

- `just: command not found` -> `just` not installed -> install `just`, then rerun.
- `Recipe \`x\` not found` -> wrong name/context file -> run `just --list`, confirm `justfile` path.
- Works in shell, fails in recipe -> shell/env mismatch -> make shell explicit and pass needed vars.
- Recipe succeeds locally, fails in CI -> hidden local state -> remove implicit dependencies; require explicit inputs.

## Validation Checklist

- `just --list` shows expected public recipes.
- Updated recipes execute successfully in the target repo.
- Changed commands remain consistent with existing project workflows.

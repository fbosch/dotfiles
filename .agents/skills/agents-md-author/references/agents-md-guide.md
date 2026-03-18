# AGENTS.md Guide

This guide distills best practices for authoring AGENTS.md files.

## Core principles

- Keep it tiny. Every token loads on every request and competes with the actual task.
- **Discoverability is the primary gate.** If the agent can find it by reading code, config, READMEs, or running standard commands — leave it out. Tech stack, directory structure, architecture overviews, and framework conventions are all discoverable.
- **Anchoring cost.** Every line biases the agent's behavior, even passive mentions. Mentioning a deprecated tool or pattern keeps it in play. Only include what you want the agent to actively use.
- Prefer stable, high-level guidance over brittle details.
- Use references for depth. Root should point outward.
- **Hazard register lifecycle:** add a line when the agent trips → investigate the root cause → fix the underlying code/config → delete the line. The file should shrink as the codebase improves.
- **Temporal decay:** AGENTS.md should shrink over time. Instructions that were essential months ago may be redundant as models improve. Audit regularly.

## Minimal root structure

Include only what is necessary to orient the agent:

```markdown
# AGENTS

<One-sentence project description.>

## Package manager
<Only if not npm. Example: pnpm workspaces.>

## Commands
- <Non-standard build or typecheck commands>

## References
- <Link to deeper docs when needed, e.g., docs/TYPESCRIPT.md>
```

## Progressive disclosure

- Move domain-specific guidance to separate docs.
- Reference those docs from root.
- Keep references one level deep from root.
- For long docs, add a short table of contents.

## Monorepo guidance

- Root AGENTS.md: repo-wide context and shared commands only.
- Package AGENTS.md: local context and package-specific commands.
- Avoid duplication across levels.

## What earns a line

A line belongs only if it passes the discoverability gate and is operationally significant:

- Non-standard package manager (`uv` instead of `pip`, `pnpm` instead of `npm`)
- Commands with non-obvious required flags (`--no-cache` to avoid false positives)
- Landmines: code that looks safe to refactor but isn't (custom middleware, deprecated-but-still-imported modules)
- Non-standard file placement or naming that contradicts framework defaults

Does NOT earn a line: tech stack, language, framework, directory layout, architecture overviews, standard commands.

## Avoid common pitfalls

- Do not over-explain basics the model already knows.
- Do not hardcode brittle paths or detailed file trees.
- Do not include codebase structure or tech stack overviews — agents discover these in their first pass.
- Do not auto-generate AGENTS.md files. Auto-generated output duplicates discoverable info, adds ~20% cost overhead, and forces the agent to reconcile two sources of truth.
- Do not let the file grow into a general README.
- Do not passively mention deprecated tools or patterns — it anchors the agent toward them.

## Example snippets

One-line description:

```text
This is a React component library for accessible data visualization.
```

Reference pointer:

```text
For TypeScript conventions, see docs/TYPESCRIPT.md
```

# AGENTS.md Guide

This guide distills best practices for authoring AGENTS.md files.

## Core principles

- Keep it tiny. Every token loads on every request.
- Prefer stable, high-level guidance over brittle details.
- Use references for depth. Root should point outward.

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

## Avoid common pitfalls

- Do not over-explain basics the model already knows.
- Do not hardcode brittle paths or detailed file trees.
- Do not auto-generate AGENTS.md files.
- Do not let the file grow into a general README.

## Example snippets

One-line description:

```text
This is a React component library for accessible data visualization.
```

Reference pointer:

```text
For TypeScript conventions, see docs/TYPESCRIPT.md
```

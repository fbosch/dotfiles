# OpenCode Snippets

## Location & Scope

- Global snippets: `.config/opencode/snippet/*.md` (stowed to `~/.config/opencode/snippet/*.md`)
- Project snippets: `.opencode/snippet/*.md` (override same-name global snippets)
- One snippet per file; filename is the main trigger (`careful.md` -> `#careful`)

## Frontmatter

Use optional YAML frontmatter:

```yaml
---
aliases: [safe, careful-mode]
description: One-line summary shown in /snippets list
---
```

- Prefer `aliases` (plural)
- Keep aliases short and memorable
- Matching is case-insensitive

## Authoring Style

- Write snippet body as direct model instructions
- Keep inline body short; move long reference blocks into `<append>`
- Compose snippets by referencing other snippets (`#other-snippet`) instead of duplicating text

## Invocation

- Inline usage: `Refactor this function #careful`
- Shell expansion is supported with command substitution blocks like `` !`git branch --show-current` ``
- Snippets are context injectors; use slash commands for full workflows

## Minimal Examples

`careful.md`

```markdown
---
aliases: safe
description: Slow down and verify assumptions
---
Think step by step. Verify assumptions before editing files.
```

`append-agent-rule.md`

```markdown
---
aliases: [agrule, agents-rule]
description: Add a prevention rule to nearest AGENTS.md after edits
---
After finishing requested edits, add one short future-facing rule to the nearest AGENTS.md for each changed path.
```

---
description: Fetch Azure DevOps product backlog item with tasks and wiki links
agent: quick
---

Fetch and structure Azure DevOps Product Backlog Item data for agent context.

PBI input: $ARGUMENTS

If `$ARGUMENTS` is empty, infer PBI ID from current branch name (for example `AB#54032`, `pbi-54032`, or `feature/54032-something`).

**Fetched data:**
!`sh -c 'OPENCODE_LIBEXEC_CWD="$PWD" bun --cwd "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/libexec" "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/libexec/azure/ado_pbi_fetch.ts" "$1" 2>/dev/null || OPENCODE_LIBEXEC_CWD="$PWD" bun --cwd "$HOME/dotfiles/.config/opencode/libexec" "$HOME/dotfiles/.config/opencode/libexec/azure/ado_pbi_fetch.ts" "$1" 2>/dev/null || echo "ERROR: Missing ado_pbi_fetch.ts"' -- "$ARGUMENTS"`

**Output format:**

```markdown
# PBI #<ID>: <Title>

## Details

- **State:** <state>
- **Type:** <work item type>
- **Assigned To:** <assignee>
- **Area Path:** <area>
- **Iteration:** <iteration>
- **Description:** <description plain text or N/A>

## Child Tasks

### Task #<ID>: <Title>

- **State:** <state>
- **Assigned To:** <assignee>
- **Description:** <description plain text or N/A>

### Task #<ID>: <Title>

...

## Wiki Links

- [<label or URL>](<url>) — source: <pbi|task:#>
- [<label or URL>](<url>) — source: <pbi|task:#>

## Fetch Warnings

- Task #<ID>: <error>
```

**Processing rules:**

- If fetched data starts with `ERROR:` output only that error as-is
- Extract PBI fields from `pbi.fields`:
  - `System.Id`, `System.Title`, `System.State`, `System.WorkItemType`
  - `System.AssignedTo.displayName`, `System.AreaPath`, `System.IterationPath`
  - `System.Description`
- Extract child task fields from each item in `tasks` using the same field names
- Include every task returned in `tasks`; preserve numeric ordering by `System.Id`
- Convert HTML descriptions (`System.Description`) to plain readable text; if empty or missing use `N/A`
- For missing assignee use `Unassigned`; for any other missing field use `N/A`
- `Wiki Links` section must include every unique entry from `wikiLinks`
- Use link text in this order of preference: `name`, then `comment`, then URL
- If no child tasks: write `- None`
- If no wiki links: write `- None`
- Include `## Fetch Warnings` only when `taskErrors` is non-empty

**Strict output:** Output ONLY the formatted markdown. First line must be the heading. No preamble, no explanations.

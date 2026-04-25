---
description: Run the Linear issue workflow for a specific issue input
agent: quick
---

@~/.config/opencode/skills/linear-issue-workflow/SKILL.md

Issue input: $ARGUMENTS

If `Issue input` is empty, respond only:
`Usage: /linear-issue <ISSUE-ID|Linear URL|pasted issue block>`

Pre-flight:

1. Treat `Issue input` as the only explicit invocation argument.
2. If `Issue input` cannot be parsed as an issue id, Linear URL, or pasted issue block, respond only:
   `Usage: /linear-issue <ISSUE-ID|Linear URL|pasted issue block>`
3. If Linear issue retrieval fails, stop and return a concise failure reason before any branch/worktree action.

Run the workflow from the skill exactly as written.

Execution constraints for this command:

1. Treat Linear MCP issue data as authoritative for operational metadata.
2. Fetch `gitBranchName` from Linear before branch/worktree decisions when it is missing from prompt input.
3. Use the `wt` CLI for branch/worktree setup.
4. Prefer specialized Linear MCP tools plus the `wt` CLI over generic shell git workflows for issue/branch orchestration.
5. Return the exact six output blocks required by the skill.

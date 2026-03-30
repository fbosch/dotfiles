---
description: Run the Linear issue workflow for a specific issue input
agent: build
---

@.agents/skills/linear-issue-workflow/SKILL.md

Issue input: $ARGUMENTS

If `Issue input` is empty, respond only:
`Usage: /linear-issue <ISSUE-ID|Linear URL|pasted issue block>`

Run the workflow from the skill exactly as written.

Execution constraints for this command:

1. Treat Linear MCP issue data as authoritative for operational metadata.
2. Fetch `gitBranchName` from Linear before branch/worktree decisions when it is missing from prompt input.
3. Use WorkTrunk for branch/worktree setup.
4. Return the exact five output blocks required by the skill.

---
description: Run the Linear issue workflow for a specific issue input
agent: build
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

Delegation model for this command:

1. Before any branch/worktree action, code edit, commit, push, or PR action, invoke the `quick` subagent as a subtask for deterministic intake work.
2. Pass `Issue input`, the pre-flight rules below, and the skill context to that subtask.
3. `quick` owns only these intake steps:
   - parse and normalize `Issue input`
   - fetch Linear issue metadata and comments when needed
   - classify initial `specSignal` and recommend `specDecision`
   - inspect OpenSpec status read-only when the workflow requires it
   - propose the branch/worktree action
4. Ask `quick` to return only an intake packet covering:
   - normalized issue identifier and input type
   - missing Linear metadata to fetch
   - initial `specSignal` and `specDecision` recommendation with rationale
   - proposed branch/worktree action
   - blockers or ambiguities that should stop execution
5. Treat the `quick` result as advisory intake only. The main agent must verify authoritative data, then execute the remaining workflow itself.
6. The `quick` subagent must not perform branch/worktree mutations, file edits, commits, pushes, or PR creation for this command.

Execution constraints for this command:

1. Treat Linear MCP issue data as authoritative for operational metadata.
2. Fetch `gitBranchName` from Linear before branch/worktree decisions when it is missing from prompt input.
3. Use WorkTrunk for branch/worktree setup.
4. Prefer specialized tools (Linear MCP + WorkTrunk plugin) over generic shell git workflows for issue/branch orchestration.
5. Return the exact six output blocks required by the skill.

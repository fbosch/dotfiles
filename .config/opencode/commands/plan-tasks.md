---
description: Decompose rough input into a structured backlog plan
agent: backlog-planning
subtask: true
---

Planning input: $ARGUMENTS

If `Planning input` is empty, respond only:
`Usage: /plan-tasks <idea|spec|issue text>`

Use the `backlog-planning` subagent behavior to produce a backlog plan from the input.

Execution rules:

1. Preserve user scope and constraints.
2. Ask follow-up questions only if a blocker prevents meaningful decomposition.
3. Do not create Linear issues.
4. Do not implement code or modify files.
5. Return the exact four sections required by the `backlog-planning` agent:
   - `Backlog summary`
   - `Assumptions`
   - `Open questions`
   - `Task plan (OpenSpec tasks.md draft)`

Output requirements:

1. `Task plan (OpenSpec tasks.md draft)` must use OpenSpec-compatible markdown:
   - numbered `##` task groups
   - checkbox tasks in `- [ ] X.Y ...` format
2. Keep task descriptions action-oriented and concise.
3. Order tasks by true dependency/blocking sequence.

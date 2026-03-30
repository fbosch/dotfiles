---
description: Decompose rough input into a structured backlog plan
agent: backlog-planner
subtask: true
---

Planning input: $ARGUMENTS

If `Planning input` is empty, respond only:
`Usage: /plan-tasks <idea|spec|issue text>`

Use the `backlog-planner` subagent behavior to produce a backlog plan from the input.

Execution rules:

1. Preserve user scope and constraints.
2. Ask follow-up questions only if a blocker prevents meaningful decomposition.
3. Do not create Linear issues.
4. Do not implement code or modify files.
5. Return the exact four sections required by the `backlog-planner` agent:
   - `Backlog summary`
   - `Assumptions`
   - `Open questions`
   - `Task plan (JSON)`

Output requirements:

1. `Task plan (JSON)` must be valid JSON.
2. Use stable task IDs (`T1`, `T2`, ...).
3. Keep titles action-oriented and concise.

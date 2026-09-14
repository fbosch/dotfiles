---
name: opencode-subagent-patterns
description: Design and implement effective subagent patterns in OpenCode. Use when creating custom agents, choosing direct work versus delegation, orchestrating multi-agent workflows, configuring tool permissions, selecting models, or writing subagent prompts.
---

# OpenCode Subagent Patterns

Use this skill for OpenCode agent and subagent design, not generic task delegation outside OpenCode.

## Route the task

1. Decide whether the primary agent should work directly or delegate. For context isolation, invocation, and that decision, read [`references/routing.md`](references/routing.md).
2. For prompt anatomy, boundaries, result contracts, and done-when criteria, read [`references/prompt-design.md`](references/prompt-design.md).
3. For built-in agents, custom agent locations, creation methods, and configuration fields, read [`references/agent-configuration.md`](references/agent-configuration.md).
4. For repetitive work and batch delegation, read [`references/delegation.md`](references/delegation.md).
5. For multi-specialist coordination and nesting, read [`references/orchestration.md`](references/orchestration.md).
6. For tool access and permissions, read [`references/tool-selection.md`](references/tool-selection.md).
7. For model and temperature choices, read [`references/model-selection.md`](references/model-selection.md).
8. For reusable audit, update, research, migration, and output templates, read [`references/prompt-templates.md`](references/prompt-templates.md).
9. For complete configured-agent examples, read [`references/examples.md`](references/examples.md).

Load only the references needed for the current task. The existing topic references are authoritative; do not duplicate their detailed procedures in this entrypoint.

## Design baseline

- Start with the smallest agent and tool set that can complete the task.
- Put scope, hard boundaries, tool routing, workflow, output, and done-when conditions in every specialized prompt.
- Prefer normal trigger wording. Reserve stronger wording for gates where underuse is materially riskier than overuse.
- Validate an agent with a representative task before relying on it in a workflow.

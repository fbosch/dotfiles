# Delegation Routing

## Work directly or delegate

Do not delegate by default. Work directly for a small direct answer, a single-file inspection, an obvious edit, or a task where the primary context already has enough evidence.

Delegate when isolated context, broad discovery, specialized judgment, or parallel work improves the result. This is most useful for repeatable workflows, verbose command output, multi-step operations where only the final result matters, or long sessions where context pressure builds up.

## Context hygiene

A subagent should absorb verbose intermediate output and return a concise result. Keep the primary context focused on the request, the child summary, and the next decision rather than copying build logs, deployment logs, or API responses into the main session.

| Consideration      | Trade-off                                                                            |
| ------------------ | ------------------------------------------------------------------------------------ |
| Context efficiency | Subagents preserve primary context for longer sessions.                              |
| Latency            | A fresh child context adds time while it gathers background.                         |
| Thoroughness       | A fast exploration agent trades completeness for speed.                              |
| Deep operations    | Agents with many tool calls are appropriate when each call advances meaningful work. |

## Invocation

Automatic delegation is based on the task description, the agent's `description`, the current context, and available tools. Use normal trigger wording in descriptions by default. Stronger wording is appropriate only where underuse is materially worse than overuse, such as security review or a mandatory validation gate.

For explicit invocation, use an `@` mention:

```text
@code-reviewer look at my recent changes
@test-runner fix the failing tests
@explore find where user authentication is handled
```

When subagents create child sessions, use `<Leader>+Right` (`session_child_cycle`) or `<Leader>+Left` (`session_child_cycle_reverse`) to move between the parent and children. Keep delegation shallow unless an orchestrator needs a second level for specialist work.

## Routing checklist

Before delegating, identify:

- The owned files or domain boundary.
- Whether the work is independent of other batches.
- The minimum tools required for discovery, editing, execution, or orchestration.
- The result format and audience.
- The condition that means the child is done or must stop and report.

For worked agent configurations, see [examples.md](examples.md).

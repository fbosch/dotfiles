# Agent Orchestration Patterns

Sub-agents can invoke other sub-agents, enabling sophisticated orchestration patterns. This is accomplished by including the `task` tool in an agent's tools configuration.

## How It Works

When a sub-agent has access to the `task` tool, it can:
- Spawn other sub-agents (built-in or custom)
- Coordinate parallel work across specialists
- Chain agents for multi-phase workflows

## Enabling Orchestration

In JSON configuration:

```json
{
  "agent": {
    "orchestrator": {
      "mode": "subagent",
      "description": "Orchestrates complex multi-phase tasks by delegating to specialized agents",
      "tools": {
        "read": true,
        "grep": true,
        "glob": true,
        "task": true
      }
    }
  }
}
```

In Markdown configuration:

```markdown
---
description: Orchestrates complex tasks by delegating to specialists
mode: subagent
tools:
  read: true
  grep: true
  glob: true
  task: true
---

You are an orchestrator agent. When invoked:

1. Analyze the task requirements
2. Identify specialized agents needed
3. Use task tool to spawn agents in parallel when tasks are independent
4. Collect all reports and synthesize findings
5. Provide unified summary with actionable insights
```

## Orchestrator Pattern

A release orchestrator that coordinates multiple specialized agents:

```markdown
---
description: Coordinates release preparation by delegating to specialized agents. Use before releases.
mode: subagent
tools:
  read: true
  grep: true
  glob: true
  bash: true
  task: true
---

You are a release orchestrator. When invoked:

1. Use task tool to spawn code-reviewer agent
   → Review all uncommitted changes

2. Use task tool to spawn test-runner agent
   → Run full test suite

3. Use task tool to spawn doc-validator agent
   → Check documentation is current

4. Collect all reports and synthesize:
   - Blockers (must fix before release)
   - Warnings (should address)
   - Ready to release: YES/NO

Spawn agents in parallel when tasks are independent.
Wait for all agents before synthesizing final report.
```

## Practical Examples

### Multi-Specialist Workflow

```text
User: "Prepare this codebase for production"

orchestrator agent:
  ├─ task(code-reviewer) → Reviews code quality
  ├─ task(security-auditor) → Checks for vulnerabilities
  ├─ task(performance-analyzer) → Identifies bottlenecks
  └─ Synthesizes findings into actionable report
```

### Parallel Research

```text
User: "Compare these 5 frameworks for our use case"

research-orchestrator:
  ├─ task(general) → Research framework A
  ├─ task(general) → Research framework B
  ├─ task(general) → Research framework C
  ├─ task(general) → Research framework D
  ├─ task(general) → Research framework E
  └─ Synthesizes comparison matrix with recommendation
```

## Nesting Depth

| Level | Example | Status |
|-------|---------|--------|
| 1 | Primary → orchestrator | ✅ Works |
| 2 | orchestrator → specialist | ✅ Works |
| 3 | specialist → sub-task | ⚠️ Works but context thins |
| 4+ | Deeper nesting | ❌ Not recommended |

**Best practice**: Keep orchestration to 2 levels deep. Beyond that, context windows shrink and coordination becomes fragile.

## When to Use Orchestration

| Use Orchestration | Use Direct Delegation |
|-------------------|----------------------|
| Complex multi-phase workflows | Single specialist task |
| Need to synthesize from multiple sources | Simple audit or review |
| Parallel execution important | Sequential is fine |
| Different specialists required | Same agent type |

## Orchestrator vs Direct Delegation

**Direct (simpler, often sufficient):**

```text
User: "Review my code changes"
Primary: [Invokes code-reviewer agent directly]
```

**Orchestrated (when coordination needed):**

```text
User: "Prepare release"
Primary: [Invokes release-orchestrator]
        orchestrator: [Spawns code-reviewer, test-runner, doc-validator]
        orchestrator: [Synthesizes all reports]
        [Returns comprehensive release readiness report]
```

## Configuration Notes

1. **Tool access propagates**: An orchestrator with `task` can spawn any subagent the session has access to
2. **Model inheritance**: Spawned agents use their configured model (or inherit if set to `inherit`)
3. **Context isolation**: Each spawned agent has its own context window
4. **Results bubble up**: Orchestrator receives agent results and can synthesize them
5. **Permission control**: Use `permission.task` to control which subagents can be invoked (see tool-selection.md)

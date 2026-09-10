---
when:
  tools:
    any:
      - subagent
---

# Subagent orchestration
- When a specialized agent fits the task, prefer it over a generic `general-purpose` or `general` agent. Use a generic agent only when no specialized agent applies or the task genuinely spans several specialties.

- Delegate only when specialist expertise, isolated context, or independent work justifies the overhead. Otherwise work directly.
- Give each worker a bounded goal, owned scope, exclusions, and acceptance criteria.
- Parallel writes require disjoint ownership and no dependencies. Keep shared work serial.
- Verify delegated results before integrating or declaring completion.
- Before coordinating a multi-worker batch, read `~/.pi/agent/references/parallel-work.md`.

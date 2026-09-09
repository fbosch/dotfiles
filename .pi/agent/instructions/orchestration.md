---
when:
  tools:
    any:
      - subagent
---

# Subagent orchestration

- Delegate only when specialist expertise, isolated context, or independent work justifies the overhead. Otherwise work directly.
- Give each worker a bounded goal, owned scope, exclusions, and acceptance criteria.
- Parallel writes require disjoint ownership and no dependencies. Keep shared work serial.
- Verify delegated results before integrating or declaring completion.
- Before coordinating a multi-worker batch, read `~/.pi/agent/references/parallel-work.md`.

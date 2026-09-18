---
when:
  tools:
    any:
      - subagent
---

# Subagent orchestration
- When a specialized agent fits the task, prefer it over a generic `general-purpose` or `general` agent. Use a generic agent only when no specialized agent applies or the task genuinely spans several specialties.

## Model and thinking presets
These presets apply only when invoking `subagent_type: "general"`. Select the lowest-cost fit and pass both `model` and `thinking` to that call. Never override a specialized agent's configured model or thinking level.

| Task complexity | Use when | Model | Thinking |
| --- | --- | --- | --- |
| Routine | Direct lookup, bounded edits, or deterministic work with clear acceptance criteria | `openai-codex/gpt-5.6-luna-fast` | `low` |
| Moderate | Multi-step planning, diagnosis, documentation, or synthesis with limited ambiguity | `openai-codex/gpt-5.6-sol` | `medium` |
| Complex implementation | Cross-file implementation or refactoring requiring sustained code reasoning | `openai-codex/gpt-5.6-luna` | `xhigh` |
| Deep technical analysis | Detailed tracing, test design, benchmarking, or failure analysis with many interacting details | `openai-codex/gpt-5.6-luna` | `max` |
| High-risk reasoning | Ambiguous contracts, security or correctness review, adversarial analysis, or decisions with material impact | `openai-codex/gpt-6-astra` | `xhigh` |

Escalate one preset when uncertainty, coupling, or impact is higher than the task's apparent size. Do not use a stronger preset merely because the task is long; use it when the task requires deeper judgment or carries greater risk.

- Delegate only when specialist expertise, isolated context, or independent work justifies the overhead. Otherwise work directly.
- Give each worker a bounded goal, owned scope, exclusions, and acceptance criteria.
- Parallel writes require disjoint ownership and no dependencies. Keep shared work serial.
- Verify delegated results before integrating or declaring completion.
- Before coordinating a multi-worker batch, load the `swarm` skill from its advertised path, or `~/.agents/skills/swarm/SKILL.md` when no path is advertised.

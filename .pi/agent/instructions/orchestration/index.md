---
when:
  tools:
    any:
      - subagent
---

# Subagent orchestration

Read these operational references BEFORE the relevant actions:

Pass each reference path below literally to `read`, including its `~/` prefix; the tool expands it. Do not guess a username, substitute a working-directory path, or search for these files. If a literal read fails, report the error rather than trying invented paths.

- Before selecting agents, preparing delegated inspection, or visualization-specific tool discovery, collection, aggregation, or rendering, read `~/.pi/agent/instructions/orchestration/routing.md`. Prefer fitting specialists; delegate requested or helpful visuals to `visualizer` regardless of simplicity. Pass named artifacts without prereading to prepare prompts. Verify availability/permission; report limitations before permitted direct fallback. Only the user's latest `@agent` selection authorizes that routing bypass. Hooks cannot override user choice or tool permissions; do not call `recommend_agent`.
- Before drafting assignments or continuations, read `~/.pi/agent/instructions/orchestration/assignments.md`. Preserve acceptance/output contracts, values, and source identifiers verbatim. Tools imply no authorization. Read procedure artifacts first; act on their actual rules. Prohibit blocking/coordination tools unless required. Work directly when loaded context suffices unless delegation rules apply.
- Before launching, supervising, looking up, steering, assessing checkpoints, resuming, replacing, or integrating workers, read `~/.pi/agent/instructions/orchestration/supervision.md`. Use native reports/notifications, not private logs or unrelated protocols. Compare opaque IDs character-for-character with original results before sending. Failed lookups/resumes do not authorize replacements. Require material updates and final-turn handoffs; the parent owns scope, verification, and integration.
- Before coordinating workers, parallel writes, dependent assignments, or dependent completion, read `~/.pi/agent/instructions/orchestration/coordination.md`. Before batches, load advertised `swarm`, otherwise read literal `~/.agents/skills/swarm/SKILL.md`. Parallel writes require disjoint ownership and no dependencies; shared work stays serial. Pass exact completed prerequisite evidence. Require actual validation, checked values, criterion, and outcome. Prerequisite success is not dependent success; missing or contradictory evidence stays unresolved.

Before EVERY `subagent` call, check arguments, not just the plan:

- The `prompt` names the actual target, required result, and constraints.
- Explicit `max_turns` is at most 12 for discovery/routine work or 24 for implementation/deep analysis, respecting lower specialist caps. Reduce oversized scope, never inflate budgets.
- Specialist calls, including resumes, omit `model` and `thinking` entirely. Only `subagent_type: "general"` uses explicit presets from `routing.md`.
- Set `run_in_background: true` for substantial work and EVERY independent batch member; launch all before waiting. Foreground permits only one bounded task or strictly sequential dependency without peer synchronization.
- Continuations use the exact returned ID in `resume`, never reconstructed IDs or fresh spawns. Resume with a bounded step, budget, authorized phase, persistent constraints, and full output contract. After two unsuccessful bounded attempts at the same deliverable, stop and diagnose directly or ask the user.

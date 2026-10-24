---
when:
  tools:
    any:
      - subagent
---

# Subagent orchestration

## Explicit specialist mentions

An `explicit-subagent-invocation` message supplies the selected catalog and initial coordination rules. For this request, prepare a focused assignment from the user message and existing context, then dispatch before investigating task files. Do not read agent definitions, skill bodies, or the references below just to prepare the initial launches. The runner validates role configuration and capabilities; a mention does not change permissions or approvals.

For multiple mentions, launch independent work in the background with disjoint write ownership or read-only scope. Keep dependencies and shared writes serial. Retrieve and verify prerequisite evidence before starting dependent work, and ask the user when scope or ordering is unclear. After dispatch, read the operational references when their supervision or verification procedures become relevant.

## Other orchestration

Outside that initial mention-dispatch phase, read these operational references BEFORE the relevant actions:

Pass each reference path below literally to `read`, including its `~/` prefix; the tool expands it. Do not guess a username, substitute a working-directory path, or search for these files. If a literal read fails, report the error rather than trying invented paths.

- Before selecting agents, preparing delegated inspection, or visualization-specific tool discovery, collection, aggregation, or rendering, read `~/.pi/agent/instructions/orchestration/routing.md`. Prefer fitting specialists; delegate requested or helpful visuals to `visualizer` regardless of simplicity. Pass named artifacts without prereading to prepare prompts. Verify availability/permission; report limitations before permitted direct fallback. Respect explicit user agent selections and native tool permissions.
- Before drafting assignments or continuations, read `~/.pi/agent/instructions/orchestration/assignments.md`. Preserve acceptance/output contracts, values, and source identifiers verbatim. Tools imply no authorization. Read procedure artifacts first; act on their actual rules. Prohibit blocking/coordination tools unless required. Work directly when loaded context suffices unless delegation rules apply.
- Before launching, supervising, looking up, steering, assessing checkpoints, resuming, replacing, or integrating workers, read `~/.pi/agent/instructions/orchestration/supervision.md`. Use native reports/notifications, not private logs or unrelated protocols. Compare opaque IDs character-for-character with original results before sending. Failed lookups/resumes do not authorize replacements. Require material updates and final-turn handoffs; the parent owns scope, verification, and integration.
- Before coordinating workers, parallel writes, dependent assignments, or dependent completion, read `~/.pi/agent/instructions/orchestration/coordination.md`. Before batches, load advertised `swarm`, otherwise read literal `~/.agents/skills/swarm/SKILL.md`. Parallel writes require disjoint ownership and no dependencies; shared work stays serial. Pass exact completed prerequisite evidence. Require actual validation, checked values, criterion, and outcome. Prerequisite success is not dependent success; missing or contradictory evidence stays unresolved.

Before EVERY `subagent` call, check arguments, not just the plan:

- The `prompt` names the actual target, required result, and constraints.
- Explicit `maxTurns` is at most 12 for discovery/routine work or 24 for implementation/deep analysis, respecting lower specialist caps. Reduce oversized scope, never inflate budgets.
- Specialist launches omit `model` and `thinking` entirely. Only `specialist: "general"` uses explicit presets from `routing.md`. Continuations retain the worker's resolved model and capabilities.
- Use `foreground: false` for substantial work and EVERY independent batch member; launch all before waiting. Foreground permits only one bounded task or strictly sequential dependency without peer synchronization.
- Continue through `subagent_control` with `request: { action: "continue", workerId, prompt, maxTurns }`, copying the returned worker ID exactly. Keep the step bounded, with its authorized phase, persistent constraints, and full output contract. After two unsuccessful bounded attempts at the same deliverable, stop and diagnose directly or ask the user.

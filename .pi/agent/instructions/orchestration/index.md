---
when:
  tools:
    any:
      - subagent
---

# Subagent orchestration

## Explicit specialist mentions

An `explicit-subagent-invocation` message supplies the selected catalog and initial coordination rules. Use the selected specialists and their catalog defaults. Prepare a focused assignment from the user message and existing context, then dispatch before investigating task files. Do not read agent definitions, skill bodies, or the references below to prepare these launches. The runner validates configuration and capabilities; a mention does not change permissions or approvals. Ask the user if scope or ordering is unclear.

## Read before acting

Except during that initial mention-dispatch phase, read each reference before its listed actions. After dispatch, read references as their procedures become relevant.

Pass these paths literally to `read`, including `~/`. Do not guess a username, substitute a working-directory path, or search for the files. Report a failed literal read rather than trying invented paths.

- Agent selection, delegated inspection, or visualization-specific discovery, collection, aggregation, or rendering: `~/.pi/agent/instructions/orchestration/routing.md`.
- Assignment or continuation drafting: `~/.pi/agent/instructions/orchestration/assignments.md`.
- Launching, supervision, lookup, steering, checkpoint assessment, resumption, replacement, or integration: `~/.pi/agent/instructions/orchestration/supervision.md`.
- Multi-worker coordination, parallel writes, dependent assignments, or dependent completion: `~/.pi/agent/instructions/orchestration/coordination.md`.

## Launch checks

Before EVERY `subagent` call, check the actual arguments and ownership:

- Name the target, required result, and constraints in `prompt`. Always pass `maxTurns`: at most 12 for discovery/routine work or 24 for implementation/deep analysis, respecting lower specialist caps. Reduce oversized scope instead of inflating budgets.
- Specialist launches omit `model` and `thinking`. Only `specialist: "general"` uses the explicit presets in `routing.md`.
- Use `foreground: false` for substantial work and every independent batch member; launch all independent members before waiting. Foreground permits only one bounded task or a strictly sequential dependency without peer synchronization.
- Independent workers need read-only scope or disjoint write ownership and no dependencies. Keep shared writes and dependencies serial. Verify prerequisite reports before launching dependent work.

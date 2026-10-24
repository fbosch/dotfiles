# Coordination

Before coordinating a multi-worker batch, load `swarm` from its advertised path. If none is advertised, pass literal `~/.agents/skills/swarm/SKILL.md` to `read`; never invent a home directory. The entrypoint defines launch ordering and write-ownership constraints.

## Dependencies and completion

- Retrieve and verify the prerequisite's completed report, then pass its exact evidence to the dependent worker. Require the worker to apply the actual acceptance rule and return checked values, criterion, and outcome, not a guessed check.
- Scope downstream workers to their own artifacts and explicitly exclude completed upstream work. Supply prerequisite evidence in the prompt instead of asking them to reread it. Reopening upstream artifacts requires a specific discrepancy and deliberate scope decision.
- Structure downstream assignments as: `Read only: <downstream paths>. Already completed: <prerequisite evidence>. Do not read: <upstream paths>. Check: <rule to apply>. Return: <exact checked values and outcome>.` Name upstream exclusions explicitly rather than relying on "no other files". State that the prerequisite is complete and no further release signal is needed.
- Verify each result before declaring completion. A successful prerequisite does not establish downstream success. Rejected verification, omitted evidence, or contradictory conclusions stay unresolved. Resume that worker with the discrepancy and required output rather than declaring success from parent inference. Do not rerun broad investigations without conflicting evidence.

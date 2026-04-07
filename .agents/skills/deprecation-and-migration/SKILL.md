---
name: deprecation-and-migration
description: Plan and execute safe deprecations and migrations. Use when replacing or removing APIs, config formats, commands, or behavior that existing consumers may rely on.
---

# Deprecation and Migration

Handle contract changes with staged rollout, compatibility windows, and explicit exit criteria.

## Use when

- Replacing or removing public APIs or interface fields
- Renaming or removing config keys, CLI flags, or commands
- Changing defaults that alter behavior for existing users
- Migrating data shape, storage, or protocol semantics

## Workflow

1. Classify the change: additive, soft-breaking, or breaking.
2. Define compatibility strategy (dual path, adapter, shim, or versioned contract).
3. Publish migration plan and warning signals.
4. Roll out in phases with telemetry gates.
5. Remove legacy path only after exit criteria are met.

## Phase template

- `Phase 0: announce` (scope, timeline, affected consumers)
- `Phase 1: dual support` (old and new paths both work)
- `Phase 2: default flip` (new path default, old path still available)
- `Phase 3: removal` (old path removed after validation)

## Required guardrails

- Keep old behavior runnable during migration window.
- Emit clear deprecation warnings with actionable next steps.
- Define cutoff criteria before removal (adoption %, error budget, date).
- Provide rollback path for each rollout phase.

## Output contract

Return:

1. `Change classification`
2. `Affected surfaces`
3. `Migration plan by phase`
4. `Compatibility and rollback strategy`
5. `Removal gate` (what must be true before deletion)

## Done when

- Migration steps are explicit and testable.
- Consumers have a clear path from old to new behavior.
- Removal is gated by observable adoption or readiness signals.

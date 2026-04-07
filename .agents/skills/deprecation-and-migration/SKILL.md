---
name: deprecation-and-migration
description: Staged deprecation and migration planning for contract changes. Use when replacing or removing APIs, config formats, CLI flags, commands, data schemas, or defaults that existing consumers may rely on.
---

# Deprecation and Migration

Handle contract changes with staged rollout, compatibility windows, and explicit exit criteria.

## Use when

- Replacing or removing public APIs or interface fields
- Renaming or removing config keys, CLI flags, or commands
- Changing defaults that alter behavior for existing users
- Migrating data shape, storage, or protocol semantics

## Strategy selector

- `Many unknown consumers` -> dual support + extended warning window + conservative removal gate.
- `Internal consumers, strong coordination` -> shorter phases with explicit owner sign-off.
- `Data migration required` -> reversible backfill + idempotent migration step + rollback rehearsal.

## Observability branch

- `High observability` (adoption telemetry + error budget + owner mapping): gate by measured readiness.
- `Low observability`: add active discovery (logs, dependency scans, owner outreach) before default flip.
- `No reliable telemetry`: do not remove on date alone; require explicit consumer attestations.

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

## Removal-gate examples

- Adoption: >= 95% of requests use new contract for 14 consecutive days.
- Stability: migration-related error rate <= 0.2% and no sev1/sev2 incidents during gate window.
- Coverage: all known top consumers validated in staging or production canary.
- Operability: rollback path tested successfully within agreed recovery time.

## NEVER do this

- Never remove legacy behavior only because a calendar date arrived.
- Never flip defaults and remove fallback in the same release.
- Never emit deprecation warnings without replacement instructions and timeline.
- Never run one-way data migrations without verified backup/restore and rollback strategy.
- Never treat "no complaints" as adoption evidence when telemetry is weak.

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

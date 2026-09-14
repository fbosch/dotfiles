---
name: deprecation-and-migration
description: Plan staged deprecation and migration for APIs, config formats, CLI flags, commands, data schemas, or defaults when an explicitly requested compatibility requirement, scoped external consumers, persisted old data, or compatibility commitments require a transition. Use coordinated internal replacement instead when all consumers can move atomically.
---

# Deprecation and Migration

Handle contract changes with staged rollout, compatibility windows, and explicit exit criteria when a transition is required.

## Use when

- Replacing or removing public APIs or interface fields with explicitly scoped consumers
- Renaming or removing config keys, CLI flags, or commands that existing external consumers use
- Changing defaults that alter behavior for explicitly supported existing users
- Migrating data shape, storage, or protocol semantics when persisted old data is in scope

## Compatibility scope gate

Before designing phases, identify the concrete obligation that requires old and new behavior to coexist:

- an explicitly requested compatibility requirement
- an explicitly scoped external consumer
- persisted old data that must still be read or migrated
- an existing compatibility commitment, such as a published contract or rollout promise

Do not infer a staged migration from a breaking-looking diff alone. If all consumers are internal and coordinated, update them and replace the old contract atomically in one change. Do not add a shim, dual-read/dual-write path, warning window, or rollout phase solely for internal coordination. If the compatibility scope is unclear and the choice materially changes the implementation, ask for clarification.

Follow the compatibility reference: do not preserve prior behavior by default, and approve compatibility code only with tests and a clear removal condition.

## Strategy selector

Use these strategies only when the compatibility scope gate identifies an obligation:

- `Many external consumers, not all known` -> dual support, an extended warning window, and a conservative removal gate.
- `Internal consumers with an explicit compatibility commitment` -> shorter phases with explicit owner sign-off.
- `Persisted old data` -> reversible backfill, an idempotent migration step, and rollback rehearsal.
- `Coordinated internal consumers without an obligation` -> atomic replacement; this is not a staged migration.

## Observability branch

For a staged migration:

- `High observability` (adoption telemetry + error budget + owner mapping): gate by measured readiness.
- `Low observability`: add active discovery (logs, dependency scans, owner outreach) before the default flip.
- `No reliable telemetry`: do not remove on date alone; require explicit consumer attestations.

For an atomic internal replacement, use repository-wide call-site checks and focused tests instead of adoption telemetry.

## Workflow

1. Classify the change: additive, soft-breaking, or breaking.
2. Establish whether external consumers, persisted old data, or a compatibility commitment is explicitly in scope.
3. If scope requires coexistence, define the compatibility strategy (dual path, adapter, shim, or versioned contract). Otherwise update all coordinated internal consumers atomically.
4. For a staged path, publish the migration plan and warning signals, then roll out in phases with telemetry gates.
5. Remove the legacy path only after the selected exit criteria are met.

## Phase template for staged migrations

- `Phase 0: announce` (scope, timeline, affected consumers)
- `Phase 1: dual support` (old and new paths both work)
- `Phase 2: default flip` (new path default, old path still available)
- `Phase 3: removal` (old path removed after validation)

## Required guardrails for staged migrations

- Keep old behavior runnable during the migration window.
- Emit clear deprecation warnings with actionable next steps.
- Define cutoff criteria before removal (adoption %, error budget, date).
- Provide a rollback path for each rollout phase.

## Removal-gate examples

- Adoption: >= 95% of requests use new contract for 14 consecutive days.
- Stability: migration-related error rate <= 0.2% and no sev1/sev2 incidents during gate window.
- Coverage: all known top consumers validated in staging or production canary.
- Operability: rollback path tested successfully within agreed recovery time.

## NEVER do this

- Never remove legacy behavior only because a calendar date arrived.
- When a staged compatibility obligation exists, never flip defaults and remove fallback in the same release.
- Never emit deprecation warnings without replacement instructions and a timeline.
- When persisted old data is in scope, never run a one-way data migration without verified backup/restore and rollback strategy.
- Never treat "no complaints" as adoption evidence when telemetry is weak.

## Output contract

Return:

1. `Change classification`
2. `Affected surfaces`
3. `Migration plan by phase` (or the atomic replacement plan when no staged migration is required)
4. `Compatibility and rollback strategy`
5. `Removal gate` (what must be true before deletion, or the atomic completion checks)

## Done when

- Migration steps or atomic replacement steps are explicit and testable.
- Consumers have a clear path from old to new behavior when coexistence is required.
- Removal is gated by observable adoption or readiness signals when staged.
- Coordinated internal consumers are updated and validated in the same change when staging is not required.

# Proposal

## Why

A fixed turn allowance can stop productive workers before they return a useful handoff. Add bounded, task-aware budget advice when the existing classifier setup is usable, without making classifier availability a prerequisite for delegation or claiming that extra turns guarantee completion.

## What Changes

- **BREAKING**: Treat a supplied `maxTurns` as the initial allowance rather than an immutable ceiling when adaptive budgeting is enabled. Keep the caller's value or the specialist's `max_turns` default as the deterministic initial allocation.
- Add an optional per-specialist `hard_max_turns` ceiling. An assignment may supply `hardMaxTurns` at or below that configured ceiling. Neither manual extensions nor classifier-assisted grants may exceed a configured ceiling.
- Make classifier support progressive enhancement. Missing, disabled, unsupported, or unusable classifier setup retains the fixed-budget and explicit-parent-extension flow. Do not add a setup requirement, startup network probe, or launch failure for an optional classifier.
- Introduce advisory checks near exhaustion, then permit automatic nudges only after evaluation and explicit enablement. Start with two-turn wrap-up checks, grants of up to four turns, and at most two automatic grants per assignment.
- Enforce live budget changes at a verified, awaited child-execution boundary. Keep ownership, cumulative accounting, cancellation, pending questions, and hard-limit enforcement deterministic.
- Show initial allowance, current allowance, configured ceiling, and budget decisions without changing read-only inspection, saved evidence, or stable session identifiers.

## Capabilities

### New Capabilities

- `pi-subagent-adaptive-budgets`: Optional classifier budgeting, deterministic grant limits, safe execution checkpoints, handoff behavior, budget evidence, and staged enablement.

### Modified Capabilities

- None in the current canonical inventory. The execution and inspection capabilities remain in the unarchived `pi-minimal-subagents` change. This capability adds conditional budgeting requirements to that baseline rather than inventing modifications to absent canonical specs.

## Impact

- Runtime implementation would affect `.pi/agent/extensions/subagents/`, specialist definitions under `.pi/agent/agents/`, `.pi/agent/subagents.json`, orchestration instructions, and neighboring tests.
- Reuse `.pi/agent/lib/classifier.ts` for configuration, trust, routing, timeout, and cancellation behavior. No dependency, package patch, lockfile update, or new model transport is proposed.
- Preserve the public tool names, fixed/manual operation without classifier setup, existing notification ownership, saved histories, and read-only transcript behavior.
- This is a follow-up to `pi-minimal-subagents`, whose full-project acceptance remains unresolved. Before runtime implementation, obtain explicit disposition of that blocker and reconcile this proposal with the accepted baseline. Proposal validation does not waive that dependency or resume the blocked notice-delivery goal.
- Actual specialist ceilings and an evidence-based automatic-grant confidence threshold remain rollout decisions. Planning does not authorize production automatic extensions.

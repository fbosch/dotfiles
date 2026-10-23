# Design

## Context

See [proposal.md](proposal.md) for motivation and scope. The runner's current child segment receives a fixed budget snapshot. Its synchronous turn-start guard enforces that snapshot, while explicit parent extension is permitted only in the existing queued and question-waiting states. Updating owner metadata alone cannot extend a running segment safely.

The baseline lives in the unarchived [pi-minimal-subagents change](../pi-minimal-subagents/). Its acceptance remains unresolved. The current canonical inventory has no subagent capability, so this change adds one cohesive optional capability rather than targeting nonexistent canonical requirements.

The confirmed decisions are that `maxTurns` is an initial allowance, hard ceilings come from specialist configuration, and classifier support is progressive enhancement.

## Goals / Non-Goals

**Goals:**

- Keep ordinary delegation useful when optional classifier setup is absent or broken.
- Place adaptive decisions behind a small budget-policy interface while keeping lifecycle and capability authority deterministic.
- Make live grants observable, attributable, bounded, and testable on both supported SDK environments.

**Non-Goals:**

- Classifier-selected initial allocations, automatic continuations, broader tool permissions, or new worker wall-clock deadlines.
- A monetary-budget ledger, proof of task completion, guaranteed model-authored handoffs, or unmeasured performance claims.
- New provider transports, dependencies, SDK patches, general workflow abstractions, or a refactor of parent observation and persistence.

## Decisions

### 1. Preserve a complete non-classifier path

Use the shared classifier requester and its local configuration, trust, and registry information. Do not run startup network probes or credential refreshes to determine eligibility. A real checkpoint can still discover auth or provider failure; that means no grant and ordinary wrap-up, not failed delegation.

Missing or disabled setup is normal and silent. Broken configured setup produces a bounded actionable diagnostic, deduplicated by reason for the owning parent lifecycle. Do not retry on every turn or poll for setup changes. A later assignment can resolve the current setup again.

Ordinary invalid budget configuration still fails preflight. Optional classifier degradation must not hide an initial allowance above a configured ceiling or invalid arithmetic.

Alternative rejected: requiring classifier readiness at startup or launch. It would turn an optimization into a runtime dependency.

### 2. Separate initial allowance, granted allowance, and ceiling

Keep specialist `max_turns` and explicit `maxTurns` as deterministic initial allocation. Add optional `hard_max_turns` and a lowering-only `hardMaxTurns` assignment override, including explicit continuations. Reject an override without a configured role ceiling.

Keep the existing snapshot `maxTurns` meaning as the currently granted allowance. Record initial allocation, optional configured ceiling, grant count, check count, allowance revision, mode, and policy version separately. Derive projections from one budget record rather than maintaining competing budget copies.

Freeze the specialist ceiling with the live worker configuration. Freeze any lowered ceiling for its assignment. Without a specialist ceiling, retain fixed/manual operation and do not infer an automatic reserve. Existing explicit-extension controls remain available; when a ceiling exists, those controls obey it.

Alternative rejected: asking the classifier to choose a ceiling or silently multiplying the caller's allowance. Neither supplies a stable authorization boundary.

### 3. Isolate budget policy without moving lifecycle ownership

Add a focused `budget.ts` under `.pi/agent/extensions/subagents/` to own budget state, deterministic grant calculations, bounded advice requests, and decision idempotency. It does not start child turns, change worker lifecycle, deliver notifications, or grant tools.

`WorkerOwner` owns parent/worker/assignment identity, actual turn accounting, execution reservations, and lifecycle eligibility. It creates each assignment budget and commits an eligible proposal through one synchronous guarded transition. The budget component rechecks its revision and limits at commit. Existing explicit parent extensions use the same limit calculation, without expanding their permitted lifecycle states.

The driver requests admission at the verified execution boundary and reads the current granted allowance. Keep classifier access in the parent control plane; children do not receive extra tools or model capabilities.

Keep `WorkerDelivery` responsible for receipt and pending-update coordination. Presentation remains in existing host/rendering code. Add budget projections and evidence, not a general transport adapter.

Alternative rejected: adding classifier logic throughout host callbacks or relaxing the public running-state extension command. Both enlarge authority and duplicate policy.

### 4. Prove an awaited checkpoint before implementing live grants

The first executable slice must demonstrate a supported awaited boundary on installed Pi 1.3.0 and the development SDK used by this runner. Do not assume an asynchronous turn-start event handler blocks the next provider request.

A pending check retains the worker's execution reservation. Apply a grant before the next child model request; never stop and replay an in-flight tool to obtain that boundary. Check processing creates no synthetic child turn.

Identify each attempt by parent, worker, assignment, active segment, and allowance revision. Use assignment/revision identity for idempotency, including across question replies, and active-segment identity for freshness. At commit, recheck the current lifecycle, pending question, cleanup health, cancellation, revision, and all numeric limits.

Cancellation, release, parent teardown, and reload abort pending advice and invalidate late results. Aborting advice is not confirmation that child execution has stopped. Preserve the existing shutdown and reservation rules.

Alternative rejected: mutating the frozen segment input or silently restarting a prompt. If no supported awaited boundary can be proven, stop the live-grant phase and retain the fixed path; do not patch the SDK or weaken acceptance.

### 5. Keep the first policy small and evidence-driven

Use these starting policy constants in one place:

- Check near exhaustion with up to two turns left.
- Add up to four turns per automatic grant, clamped to the remaining configured ceiling.
- Permit at most two automatic grants and two shared classifier invocations per assignment.
- Attempt at most one invocation per allowance revision. A failed or uncertain attempt commits wrap-up for that revision rather than retrying.
- Preserve all counters across questions, replies, and explicit manual extensions.

A shared invocation can use the requester's existing provider routing. Do not add another application-level retry loop, and measure actual provider attempts separately from invocation counts.

The judgment concerns whether another bounded increment is likely to advance the assigned task. Code computes the increment and decides whether it is permitted. A probability is neither authorization nor proof of progress. Known pending input, approval needs, or lifecycle blocks bypass classification and use the existing yield/stop flow.

Use advisory mode first. Usable classifier setup and a role ceiling make advice available by default, not automatic grants. Automatic mode additionally requires explicit enablement and a reviewed threshold derived from evaluation. Incomplete automatic readiness remains non-granting and is disclosed.

When no grant applies, retain normal bounded wrap-up and the hard stop at the currently granted allowance. Request a final report rather than promise one will arrive. Very short assignments do not acquire extra reserve turns. Further tool restrictions during handoff require explicit evaluation before adoption; a warning alone must not be reported as enforced tool cessation.

Alternative rejected: classifying every turn or predicting initial budgets from the full task prompt. Both add cost before useful progress evidence exists.

### 6. Limit classifier data and keep evidence complete

Build requests from an explicit allowlist of non-sensitive specialist/task categories, parent-provided task metadata approved for classification, cumulative counters, and structural tool-outcome signals. Do not copy the full assignment prompt, worker updates, raw commands, paths, transcripts, or tool bodies into a summary. Do not add an automatic summarizer.

Only schema-validated outcome fields support success signals. Tool invocation, a changed file, or a fulfilled wrapper result alone does not prove useful progress. Missing visibility is unknown, not success. If safe context is insufficient, prefer uncertain advice.

Store typed decisions, reason codes, mode, revision, counts, timing, provider identity, and reported usage when available. Do not persist request bodies or raw classifier responses for debugging. Record classifier overhead separately from child usage; reported cost is not a monetary ceiling.

Detailed views expose initial/current/ceiling and distinguish advice from an applied grant. Normal status and redraws use lightweight projections and trigger no classifier work. Successful grants use existing attributed material-update delivery; keep routine advice in detailed inspection rather than generating a message every turn.

Preserve complete reports, transcripts, and tool-result `details`. Saved metadata is additive. For older records, preserve known allowances and mark new facts unavailable instead of guessing their initial allocation or reconstructing an executable policy.

Alternative rejected: feeding full snapshots to the classifier or replaying persisted decisions as authority after reload.

## Risks / Trade-offs

- A classifier can reward apparent progress or miss useful work. Bound spending deterministically, evaluate against independently checked outcomes, and keep uncertainty non-granting.
- Optional provider calls can hold a scarce execution slot. Use bounded request timeout and cancellation, then continue wrap-up without application retries.
- Worker or tool text can contain injection or secrets. Use purpose-approved metadata and allowlisted structural fields, test canary exclusion, and never let advice change permissions.
- Budget meaning changes can mislead callers or readers. Update tool schemas, continuation handling, role documentation, orchestration instructions, receipts, and tests together.
- Two reserve turns cannot guarantee a handoff, and a turn cap cannot guarantee a cost cap. Preserve partial evidence and report missing metrics honestly.
- Old acceptance failures can be mistaken for a new success. Keep baseline disposition and runtime validation separate from this proposal's structural checks.

## Migration Plan

1. Obtain explicit disposition of the existing runner acceptance blocker and reconcile this delta with the accepted baseline before runtime implementation.
2. Prove the awaited-checkpoint fixture on both SDK environments, including cancellation before a late positive response.
3. Implement fixed/manual operation and configured limits first, with fake advisor outcomes and no dependency changes.
4. Add optional advisory classification, additive evidence, and presentation. Leave automatic grants disabled.
5. Evaluate fixed and advisory runs on bounded tasks with independently checked deliverables and handoffs. Record completion, wasted work, grant eligibility, latency, and available child/classifier usage.
6. Review actual specialist ceilings and calibrate the confidence threshold. Enable automatic grants only for reviewed roles after deterministic safety and live acceptance pass.
7. Roll back automatic grants through the budget mode; if needed, disable advice and retain fixed/manual operation. Do not run a second runner, rewrite saved histories, or revive historical workers.

## Open Questions

- Which reviewed ceilings should individual specialists receive? The 16-to-24 progression is a fixture, not a production default.
- Which confidence threshold is justified by advisory results? Automatic mode remains unavailable until that decision has supporting evidence.

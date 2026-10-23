# Tasks

Check tasks only after their implementation or verification evidence exists. Proposal validation does not establish runtime acceptance or resume the blocked notice-delivery goal.

## 1. Establish the baseline and prove safe live admission

- [x] 1.1 Obtain explicit disposition of the unresolved `pi-minimal-subagents` acceptance blocker and reconcile this capability with the accepted execution/inspection baseline; verify a recorded decision identifies remaining blockers rather than treating scoped passes as acceptance.
- [x] 1.2 Prove an awaited pre-request checkpoint on installed Pi 1.3.0 and the development SDK using a fake provider and delayed advisor; verify event traces show no next model request before admission, no tool replay, and cancellation discarding a late positive result. Record the supported boundary and limitations in the runner documentation.

## 2. Make fixed/manual budgets honor configured limits

- [x] 2.1 Resolve optional specialist `hard_max_turns` and lowering-only assignment `hardMaxTurns` with deterministic initial `maxTurns`; verify neighboring tests cover defaults, equal and lowered ceilings, missing role ceilings, invalid overrides, safe-integer limits, and rejection before child startup.
- [x] 2.2 Introduce one assignment budget record with initial/current/ceiling, revision, grant counts, and check counts while preserving the no-classifier fixed/manual flow; verify existing budget tests and new configured-ceiling tests pass without changing permitted manual-control lifecycle states.
- [x] 2.3 Carry the budget contract through tool launch, routed launch, explicit continuation, and frozen specialist snapshots; verify all entry paths share validation and update tool descriptions, specialist examples, and orchestration guidance for the initial-versus-ceiling distinction.

## 3. Apply bounded live grants with a fake advisor

- [x] 3.1 Connect budget admission and guarded commit to the proven driver boundary; verify integration fixtures exercise 16-to-20-to-24 grants, a partial increment near the ceiling, rejection of a third grant, and the next child turn observing the updated allowance.
- [x] 3.2 Preserve cumulative turns, revisions, and consumed grant/check counts across questions, replies, and manual extensions; verify repeated and concurrent checkpoint events cannot duplicate requests or grants and only explicit continuation creates a fresh assignment.
- [x] 3.3 Enforce stale-decision invalidation and bounded handoff; verify cancellation, release, teardown, reload, assignment changes, and cleanup uncertainty prevent late grants, while short allowances and failed handoffs preserve partial evidence without hidden retries. Document the distinction between requested wrap-up and guaranteed model output.

## 4. Add optional advisory classification without a setup dependency

- [x] 4.1 Reuse the shared classifier requester and passive configuration/trust/registry checks; verify missing, disabled, unsupported, auth-failing, and otherwise unusable setup leaves delegation operational, produces no startup probes, and deduplicates diagnostics for broken configured setup.
- [x] 4.2 Build allowlisted non-sensitive requests from approved task metadata and schema-validated structural outcomes; verify secret-canary and injection fixtures exclude raw prompts, transcripts, tool bodies, commands, and private paths while insufficient evidence remains non-granting.
- [x] 4.3 Implement bounded advisory checks and deterministic fallback using the shared timeout and cancellation behavior; verify one invocation per allowance revision, at most two per assignment, no application retry loop, and failure or uncertainty retaining the allowance. Document that usable setup enables advice, not automatic spending.

## 5. Make budget decisions inspectable and durable

- [x] 5.1 Add budget decision evidence without changing stable identifiers or rewriting saved sessions; verify new records round-trip, older histories retain known facts without invented initial allowances or ceilings, tool-result details survive, and restored records cannot execute checks or grants.
- [x] 5.2 Project initial/current/ceiling, advisory versus applied decisions, and available classifier usage into detailed inspection; verify narrow-layout and unavailable-metric fixtures, lightweight status projections, read-only transcripts, and no classifier work caused by rendering. Update inspection documentation with supported examples.
- [x] 5.3 Deliver material grants through existing notification ownership and keep routine advice in detailed inspection; verify notification/wait deduplication, delivery-time freshness, and bounded setup diagnostics without refactoring parent observation or persistence.

## 6. Evaluate advice before enabling automatic nudges

- [x] 6.1 Create bounded non-sensitive pilot fixtures with independently checked deliverables and labels for productive progress, stalled work, insufficient evidence, and approval/input blockers; verify fixture assertions distinguish tool activity and model-authored claims from actual outcomes.
- [ ] 6.2 Run fixed/advisory comparisons through the existing project workflow and calibrate an automatic-grant threshold; verify a saved evaluation artifact reports recommendation quality, failures, latency, actual provider attempts, and available worker/classifier usage without claiming unmeasured savings.
- [ ] 6.3 Run controlled adaptive fixture comparisons after threshold review, without enabling production roles; independently verify resulting deliverables and handoffs, record wasted work and added resource use, and require zero deterministic limit or lifecycle violations before recommending rollout.
- [ ] 6.4 Review actual specialist ceilings and explicitly enable automatic mode only for accepted roles; verify configured bounds, missing-readiness non-granting behavior, classifier-unavailable fallback, and rollback to advisory or fixed/manual operation. Record the reviewed values and evidence rather than adopting fixture ceilings as defaults.

## 7. Verify integrated acceptance

- [x] 7.1 Run the runner's existing devenv test workflow, installed/development SDK fixtures, typecheck, and changed-file lint; verify recorded commands, totals, skips, and failures cover both no-classifier and enhanced operation without dependency or lockfile changes.
- [ ] 7.2 Run full project validation after prerequisite disposition; verify every remaining failure has an explicit disposition and do not substitute scoped checks or proposal validation for acceptance.
- [ ] 7.3 Exercise live foreground/background work, queue capacity, pending questions, cancellation, release, parent teardown, and reload with absent, working, and failing classifier setup; verify UI evidence, reservation cleanup, read-only inspection, and late-result rejection before declaring runtime acceptance.

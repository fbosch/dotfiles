# Tasks

Implementation starts with baseline measurement. Task group 1 is a blocking feasibility gate for every runtime implementation group that follows it. Put new JavaScript/TypeScript tests in neighboring `__tests__` directories and add/run project checks through `devenv test`.

## 0. Capture the current baseline

- [x] 0.1 Record installed runner and local integration footprint, context components, and explicitly defined complexity measures in `references/baseline.md`, with reproducible scope, versions, source identities, and measured-versus-estimated labels; verify totals against collected evidence.
- [x] 0.2 Record repeated minimal-response and fixed read-only task samples using the current runner, including exact workload/model settings, launch and completion timing boundaries, available usage, correctness checks, and limits; verify raw samples support the reported summaries and identify missing metrics without inventing values.

## 1. Establish supported Pi integration paths

- [x] 1.1 Audit selective child loading against the installed Pi docs, SDK, and current integrations; deliver `references/feasibility.md` with checked source/API evidence for codemode, hashline, tool allowlists/discovery, provider/model hooks, mandatory policies, scoped skills, and parent-only delegation. Verify actual callable capabilities rather than only rendered catalogs.
- [x] 1.2 Audit the native TUI path; record supported APIs and a bounded feasibility check for inline progress, a four-row widget, `/subagents`, list/transcript navigation, follow/scroll preservation, and cancellation confirmation without gotgenes internals or private Pi UI patches.
- [x] 1.3 Audit lifecycle and storage hooks; record evidence for foreground versus background interrupt handling, question yielding, shutdown confirmation, switch cancellation/confirmation, reload teardown, a cleanup-unknown block that survives reload, parent-scoped storage, and deletion of worker artifacts with the parent.
- [x] 1.4 Review the three findings against every affected requirement and mark the gate passed only when each has a supported implementation path; if a host gap requires changed behavior or a Pi patch, stop and obtain a user decision before later tasks. Verification: the feasibility artifact records checked versions, evidence, limitations, and an explicit pass/block outcome without claiming unrun tests.

## 2. Launch one correctly configured specialist

Progress: the user requested runner cutover before the remaining acceptance campaign. The production entry point, all 20 specialist definitions, routed commands, mentions, orchestration instructions, and settings now target the replacement. Installed Pi 1.3.0 registers exactly the three new runner tools. Focused checks pass 111 tests and 588 assertions; 15 installed-host tests pass. Live `quick` and `general` smoke checks returned `RUNNER_OK`. This thread still needs a reload. Terminal interaction, complete production lifecycle acceptance, inactive old-source cleanup, broad validation, and baseline comparison remain incomplete. See `references/implementation-audit.md`.

- [ ] 2.1 Implement specialist resolution, explicit central capability bundles, a mandatory baseline, scoped on-demand skills, and permitted model/thinking overrides; verify neighboring tests cover missing components, tool registrations outside the allowlist, unauthorized overrides, and unchanged required policies.
- [ ] 2.2 Launch a full in-process Pi child through the shared launch interface with fresh context by default and optional textual inheritance; verify tests cover role identity, project instructions, parent text/summaries, excluded tool results/images, selected skill catalogs, and unavailable nested delegation.
- [ ] 2.3 Add background-default and explicit foreground execution through the same owner, with stable worker/parent identities and preflight failure reporting; verify an end-to-end fixture launches one worker, returns its ID or awaited outcome, and refuses foreign-owner control and partial-start failures without leaking resources.
- [x] 2.4 Document specialist fields, bundle dependencies, launch inputs, and preflight failures alongside the extension; verify examples resolve through the tested configuration path and do not imply OS sandboxing or true context forks.

## 3. Deliver and inspect one assignment's evidence

- [ ] 3.1 Implement separate execution, persistence, and live-session availability facts with complete report/transcript storage under the parent; verify tests cover successful evidence, partial output, failed writes with in-memory retrieval, and read-only restoration after restart without worker revival.
- [ ] 3.2 Implement structural background receipts and full report retrieval, returning reports directly through foreground completion or explicit wait; verify report text beyond ordinary preview sizes remains intact and completion/wait races do not create duplicate notifications or lost outcomes.
- [ ] 3.3 Implement current-status and bounded transcript inspection in the inspect/wait interface; verify ordinary status omits investigation logs, transcript selection returns the requested evidence, and report retrieval does not invoke a summarizer or archive model call.
- [x] 3.4 Document receipt meaning, explicit evidence retrieval, storage-failure behavior, and the distinction between completion and verification; verify documentation examples match the tested result payloads and report no arbitrary final-report cap.

## 4. Run bounded parallel work and answer questions

- [ ] 4.1 Add the shared six-slot queue for foreground/background launches and continuations; verify tests cover the seventh launch, foreground work at capacity, queued cancellation, retained idle sessions, and slot release only after an execution segment settles.
- [ ] 4.2 Apply specialist defaults of 12/24 turns, preserved lower limits, explicit assignment overrides/extensions, and the two-turn wrap-up warning; verify hard-limit partial handoff, no separate worker deadline, and a fresh budget only for a new bounded assignment.
- [ ] 4.3 Implement parent questions with worker/assignment/question correlation and safe slot yielding; verify stale/duplicate replies are rejected, foreground waits return pending questions, answers re-enter the queue, and repeated questions preserve the remaining budget.
- [ ] 4.4 Implement material updates and parent steering with attributed output and state-specific validation; verify routine tool activity creates no conversational update and late updates do not invite steering of a stopped worker.
- [x] 4.5 Document the queue, question/reply, wait-timeout, update, and budget contracts; verify worked sequences demonstrate concurrent launches, a waiting worker yielding capacity, and parent-managed dependencies without batch/workflow APIs.

## 5. Stop and continue workers without losing ownership

- [ ] 5.1 Implement explicit continuation of eligible cleanly stopped live sessions while freezing their resolved configuration; verify changed specialist files do not affect retained workers and cancelled, released, foreign, historical, or cleanup-unknown workers cannot continue.
- [ ] 5.2 Implement stopping versus confirmed cancellation, terminal explicit cancellation, and pending-question invalidation; verify a stopping worker retains capacity, queued work never starts after cancellation, and partial evidence remains inspectable without a success claim.
- [ ] 5.3 Implement cleanup-unknown health blocking and diagnostics using the verified host path; verify uncertain shutdown blocks launches/continuations, retains its reservation, and cannot be cleared by an extension reload.
- [ ] 5.4 Implement parent Escape semantics and wait return conditions; verify foreground interruption cancels its worker, background-wait interruption/timeout leaves its worker alive, independent background work survives parent interruption, and abandoned waits do not suppress later completion receipts.
- [ ] 5.5 Implement live-session release, parent switch confirmation/teardown, reload teardown, and parent-coupled artifact deletion; verify declined switches preserve work, confirmed switches release sessions, reload never transfers live workers, saved history survives resource release, and supported parent deletion includes its worker artifacts.
- [x] 5.6 Document continuation eligibility, explicit release, interrupt/reload behavior, and restart recovery limits; verify examples distinguish accepted cancellation from confirmed termination and native request retry from assignment replay.

## 6. Inspect and cancel work through one native TUI

- [ ] 6.1 Implement inline foreground progress and the event-driven background widget; verify rendering fixtures cover four-row attention ordering, stable launch order, overflow, stopping state, visible cleanup/error warnings, terminal resizing, and finished workers moving to history.
- [ ] 6.2 Implement the `/subagents` overlay with parent-scoped worker/history selection, full final reports, detailed metrics, and read-only transcripts; verify standard Pi Enter/Escape/focus/scroll behavior, missing-metric display, and unavailable controls for historical/released workers.
- [ ] 6.3 Implement live transcript following and preserved selection/scroll state; verify new events follow at the bottom, manual upward scrolling pauses following, returning to a worker preserves position, and the follow action resumes without worker polling.
- [ ] 6.4 Add confirmed cancel-one/cancel-all actions through the same control interface; verify rejected confirmation has no effect, stopping remains visible until shutdown, and inspection/cancellation UI never introduces direct child chat or an unrelated model turn.
- [ ] 6.5 Document UI access and navigation, then perform bounded visual/interactive checks at representative terminal sizes; verify the widget does not obscure the editor, warning states remain readable, and the overlay matches the agreed read-only interaction contract. Record actual checks and remaining platform limits.

## 7. Cut over local consumers and verify the complete workflow

- [ ] 7.1 Adapt routed prompt commands, specialist definitions, and orchestration instructions to the new launch/control contracts and defaults; verify integration tests exercise the same preflight/queue through commands and tools, and instructions preserve parent-only workspace ownership without contradictory old API guidance.
- [ ] 7.2 Replace gotgenes-specific widget/transcript links and steering notice integration with the new native inspection path; verify the supported parent UI has one worker widget/overlay path and independent handoff/checkpoint behavior remains functional without an old-runtime API shim.
- [ ] 7.3 Perform the coordinated settings/package cutover and remove obsolete runner-only integrations/exclusions; verify only the new runner registers in the target session, preserve unfamiliar worktree changes and existing saved session files, and use the repository's dependency workflow rather than manually editing generated state.
- [ ] 7.4 Run neighboring tests, relevant project checks through `devenv test`, and strict OpenSpec validation; verify all current-contract scenarios pass or report exact gaps. Include a multi-worker lifecycle exercise spanning queueing, questions, interruption, storage failure, continuation, reload, and history inspection.
- [ ] 7.5 Compare the new setup with the actual current baseline on representative tasks before claiming leanness gains; record model-visible instructions/tool overhead, local integration code, successful outcomes, total tokens, latency, and retained resource behavior with measurement limits. Do not reuse the unrelated reference benchmark as evidence.
- [ ] 7.6 Review acceptance evidence and the coordinated rollback procedure; verify rollback can restore the prior tracked runner/integrations without dual registration, deleting evidence, or overwriting unrelated work. Mark implementation complete only after required checks and any feasibility-driven user decisions are resolved.

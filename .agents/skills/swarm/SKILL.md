---
name: swarm
description: Coordinate bounded parallel workers and return one verified result. Use whenever the user explicitly asks to swarm, fan out, parallelize across workers, run independent reviews, compare competing solutions, race models, or cover several angles. Also use to make a swarm request safe when workers would overlap, share writable files, or lack isolation. Prefer direct work when delegation adds no useful independence or coverage.
---

# Swarm

Split independent work among workers, collect their results, and verify one consolidated outcome. The coordinator owns shared decisions, integration, and the final report.

**Hard safety gate:** Never launch concurrent writers whose owned paths overlap or whose isolation is unknown. User preference for speed does not override this gate. Serialize the work, use read-only proposals with serial integration, or establish real isolated workspaces first.

Inspired by [Cursor's pstack swarm skill](https://github.com/cursor/plugins/blob/main/pstack/skills/swarm/SKILL.md). This workflow does not require a particular harness, model, or execution environment.

## 1. Frame

Track framing, execution, verification, and reporting with the available task tracker or a short checklist. Before launching a worker or beginning a sequential fallback, state the plan so these decisions are observable:
- State the completion condition, required output, and acceptance checks.
- Choose **coverage** for separate slices, **race** for competing answers to the same brief, or **mixed** for races within coverage slices.
- For races, declare the selection rule before launch: **first pass** selects the first independently verified candidate meeting every acceptance criterion; **rank all** compares every candidate against stated criteria; **best-of** selects the strongest candidate after all results arrive. State the ranking criteria for the latter two.
- Set the total worker count and concurrent limit separately. Start with 2–4 concurrent workers, bounded by available capacity and user limits. Queue additional work. Respect configured resource budgets; do not retry indefinitely.
- Prefer suitable specialists and configured model defaults. Specify models only when the task or a deliberate model race calls for them. Do not invent model identifiers.
- Inspect available delegation, collection, steering, and cancellation capabilities. In Pi, read [the Pi adapter](references/pi.md). Elsewhere, use the harness's documented equivalents. If delegation is unavailable, disclose that limitation and perform the planned slices sequentially. Do not collapse them into untracked direct work: record a status and evidence for each slice using the same report contract.

Ask only when missing scope, authorization, or selection criteria would materially change the result. Otherwise state the working assumptions and proceed.

## 2. Assign ownership

Default workers to read-only. An implementation request permits only scoped changes, not commits, pushes, dependency changes, or other separately restricted actions.

Before launch, compare every writer's intended paths and dependencies. Concurrent writes require disjoint owned files or isolated workspaces and no dependencies between workers. If ownership overlaps, is uncertain, or targets shared or generated output, do not launch concurrent writers: serialize the work, use read-only proposals with serial integration, or obtain real isolation. Background execution and separate report files do not isolate source edits. Race candidates must not edit the same working tree paths; use read-only proposals unless authorized isolation is available.

Give each worker a self-contained brief:

```text
Goal: one independently verifiable outcome
Scope: exact owned files, symbols, or inputs; coverage slice or race arm
Context: relevant facts, paths, constraints, and prior decisions
Exclusions: unowned paths and actions; no scope expansion or further delegation
Deliverable: report or uniquely owned artifact
Acceptance: observable completion criteria and validation commands/checks
Budget: bounded effort and stopping conditions
Report:
  status: PASS | ISSUES | BLOCKED
  summary: concise outcome
  evidence: paths, line references, commands, or sourced observations
  changed_files: explicit list, or none
  validation: checks run and results; checks not run
  blockers: missing inputs, failures, uncertainty, or none
  recommended_next_action: one concrete next step, or none
```

Workers must stop and report before editing an unowned path or making a shared design decision. `PASS` requires evidence for the assigned acceptance criteria; it is not permission to declare the whole task complete.

## 3. Launch and collect

Launch independent workers together up to the concurrent limit. Record each worker's identifier, scope, and output location. Do not start dependent work until its prerequisite has been verified.

Prefer completion notifications or blocking waits over repeated status polling. Steer a worker when a material correction is needed, not to duplicate its work. Before retrying a stalled or failed writer, confirm it has stopped or isolate the replacement so they cannot write concurrently.

Collect terminal results for every launched worker. A dropout leaves a gap, not an implicit pass. Reassign a required slice within the budget, cover it directly, or report the swarm as blocked. When recovery is prevented by the current budget or capacity, name the missing evidence and the concrete recovery action to take once capacity is available.

For first-pass races, verify the candidate before selecting it. Cancel remaining workers if supported, then confirm termination. If cancellation is unavailable, drain their results before finishing. Never leave writers running after integration or the final report.

## 4. Verify and integrate

Treat worker reports as evidence, not proof.

- Compare actual changes with ownership and preserve unrelated worktree changes.
- Check each required coverage slice against its acceptance criteria. Preserve failures, contradictions, and missing evidence.
- Apply the declared race rule. Do not equate confidence, majority agreement, or earliest completion with correctness.
- Resolve conflicting findings against source material or a targeted check. Keep unresolved disagreement visible.
- Integrate selected changes serially, within the user's authorization. Do not combine competing implementations blindly.
- Run the final acceptance checks on the integrated result. Per-worker checks do not establish that the combined result works.

A swarm is complete only when required slices are verified, the selection rule is satisfied, integration checks pass where applicable, and every launched worker is accounted for. Otherwise report the incomplete or blocked outcome explicitly.

## 5. Report

Return one consolidated answer, not raw worker transcripts:

- Outcome and selected candidate, including the race rule when used.
- Compact table: worker/slice, status, key evidence.
- Confirmed findings or changes, ordered by severity or relevance.
- Validation performed, gaps, dropouts, and unresolved blockers.

Reconcile the task tracker with the actual outcome. Do not mark unfinished implementation or failed required checks complete.

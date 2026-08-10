---
name: parallel-work-orchestrator
description: Split large repository tasks into safe, independently executable work units and coordinate bounded OpenCode subagents. Use when a request involves a large repetitive migration, audit, cleanup, test addition, documentation update, lint backlog, or similar work that may be parallelized without overlapping changes. Builds an approval manifest, routes each unit to the appropriate existing subagent, validates results, and reconciles the combined outcome. Do not use for small changes or tightly coupled design work.
---

# Parallel Work Orchestrator

Coordinate large tasks through a conflict-aware fan-out and fan-in workflow. Prefer a smaller serial plan when independence cannot be proven.

## Workflow

### 1. Establish the objective

Define an observable outcome and validation before delegating. Identify repository guidance, source scope, baseline state, generated outputs, shared files, and commands that may write shared state.

Use direct work instead when the request is small, a task has only one coherent unit, or the change is coupled through a shared interface or state machine.

### 2. Inventory and classify

Gather the complete input set before creating workers: diagnostics, search results, files, packages, test failures, documents, or explicit items. Prefer structured input from tools over manually inferred lists.

Classify each candidate unit:

- **Read-only:** audit, discovery, comparison, or inventory.
- **Mechanical:** bounded repetitive transformation with local verification.
- **Behavior-preserving refactor:** structural cleanup with unchanged contracts.
- **Semantic or cross-cutting:** requires design judgment, public-contract changes, or uncertain write paths.
- **Shared-surface:** modifies configuration, manifests, generated files, central exports, snapshots, common fixtures, or another shared resource.

Keep semantic, shared-surface, and tightly coupled work serial unless an explicit dependency order yields independently owned units.

Use this decision table before partitioning:

| Condition | Action |
| --- | --- |
| Exact disjoint write sets | Parallelize in one wave. |
| Dependency-ordered work | Put dependents in later waves. |
| Shared or uncertain write sets | Serialize or make the coordinator own the shared work. |
| Central API, state-machine, or public-contract change | Do not use fast fan-out. Route deliberately or keep it serial. |

### 3. Build the manifest

Assign every writable path to exactly one unit in an active wave. A unit needs one goal, explicit owned paths or inputs, dependencies, acceptance criteria, validation, and a route. Treat unknown write sets as conflicts, not as permission to proceed.

Coordinator-own shared resources. Do not assign them to a worker. Sequence dependent units into later waves rather than running them concurrently.

For write-capable or resumable work, read [references/manifest-schema.md](references/manifest-schema.md) for the required shape and approval format. Do not load it for a small direct task or a read-only task that needs no manifest.

### 4. Obtain approval

For any write-capable fan-out, present the manifest before launching workers. Include units, ownership, dependencies, routes, concurrency, validation, shared resources, and the expected number of waves. Do not start write-capable workers until the user approves.

Read-only work may start without approval when the scope is clear and no external side effects occur.

### 5. Route and dispatch

Read `.config/opencode/instructions/orchestration.md` before selecting agents. Apply its routing rules and use the fewest agents needed.

Use these routes:

- **`quick` by default:** tightly scoped, well-specified, independent mechanical edits, focused cleanup, bounded command workflows, and lightweight checks. Give it exact ownership and acceptance criteria.
- **`refactor` selectively:** behavior-preserving structural improvements within an explicit owned scope. Do not use it for features, migrations that alter contracts, or design decisions.
- **`explore`:** read-only discovery when inventorying a large unknown area benefits from isolated context.
- **`test`, `debug`, `docs`, `research`, `review`, `validate`, or `general`:** route only when the unit's primary work matches the specialist described in the orchestration instructions.

Never send a semantic or cross-cutting unit to `quick` merely to increase parallelism. Escalate it to the appropriate specialist or keep it coordinator-owned.

Run 2-4 independent workers per wave. Bundle related work so a standard unit contains roughly 5-8 simple items; reduce the batch size when complexity or validation cost is high.

Immediately before dispatching a worker, read [references/worker-prompt.md](references/worker-prompt.md) and fill it from that unit's approved manifest. Do not load it when no workers will run. Pass exact unit details rather than asking a worker to discover or claim work dynamically.

### 6. Validate and reconcile

Use a shared worktree only with cooperative isolation:

- Ensure every write path has one owner per wave.
- Prohibit repository-wide fix, format, and generation commands because they can modify another worker's ownership scope.
- Prohibit dependency installation, Git integration, and cleanup commands because they mutate shared repository state outside a worker's unit.
- Run validations that write snapshots, generated outputs, coverage, or shared caches serially because concurrent writes can race or produce misleading failures.
- Audit actual changed paths against the approved ownership union after every wave.
- Validate each unit independently; do not accept a worker report as proof.
- Run the repository-level acceptance check after each wave where practical and always at the end.

Do not use dynamic worker claiming in a shared worktree: an assignment can change while another worker is already editing, so it cannot prove non-overlap.

Retry once only when the cause is clearly local. Otherwise mark the unit blocked, re-route it, or serialize the remaining work. Stop when the objective passes, dependencies or shared surfaces prevent safe partitioning, two waves make no progress, or the baseline changes enough to invalidate the manifest.

## Worker Result Handling

Require workers to return a concise status, changed paths, validation evidence, remaining work, and blockers. Compare changed paths against the manifest before considering a unit complete.

Treat these results as follows:

- `PASS`: audit paths, run unit validation, then mark complete.
- `NOOP`: verify the outcome already passes before marking complete.
- `BLOCKED_CROSS_SCOPE`: preserve the worker's changes only if they remain valid and in scope; create a coordinator-owned or dependency unit for the blocker.
- `NEEDS_STRONGER_MODEL`: route to the named specialist; do not retry with `quick`.
- `FAILED`: retry once only if a concrete local correction exists; otherwise stop that unit and report the gap.

## Completion Report

Report the approved units, routes used, validation evidence, completed and blocked units, residual work, and any limitations of shared-worktree isolation. Do not commit, merge, push, or remove worktrees unless the user explicitly requests it.

# Subagent orchestration

Use the injected agent descriptions for role selection.

Use `subagent` only when specialist expertise, isolated context, or independent parallel work clearly reduces effort. Work directly for simple answers, obvious edits, narrow inspections, and work already understood in the parent context.

Use the smallest effective set of agents: enough to reduce total effort, increase confidence, or shorten wall-clock time. Do not split work merely to create parallelism.

## Autonomous parallel work

When a task contains multiple independently verifiable units, partition it internally and fan out without a separate manifest or approval step. Each unit must have one goal, exact owned files, symbols, or inputs, explicit exclusions, relevant context, acceptance criteria, validation, and a required result format.

- Parallelize only when write sets are disjoint and dependencies are absent. Default to read-only delegation; permit concurrent writes only when ownership is proven. Keep shared, generated, uncertain, or dependency-ordered work coordinator-owned and serial.
- Use `quick` for independent, well-specified mechanical units. Route semantic or cross-cutting work to the appropriate specialist or keep it coordinator-owned.
- Launch one `subagent` per unit with `subagent_type: "quick"` and `run_in_background: true` in one `multi_tool_use.parallel` batch. Use 2-4 workers by default, queue additional units, and respect configured concurrency.
- Workers must not discover, claim, delegate, or expand work. They must stop before editing an unowned path or making a shared design decision.
- Require each worker to return: `status`, `summary`, `evidence`, `changed_files`, `validation`, `blockers`, and `recommended_next_action`.
- After each wave, the parent must compare actual changed paths with ownership, validate every unit, preserve failures and contradictions, resolve shared work serially, and run the final acceptance check. Delegated results are evidence, not proof.

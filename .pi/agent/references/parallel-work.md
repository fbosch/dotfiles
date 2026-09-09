# Parallel work

- Partition independently verifiable work without a separate manifest or approval step. Give each worker one goal, exact owned files, symbols, or inputs, exclusions, relevant context, acceptance criteria, and validation instructions.
- Use `quick` for well-specified mechanical work. Select a suitable specialist for semantic work; keep shared or cross-cutting decisions with the coordinator.
- Launch independent workers together with `multi_tool_use.parallel` and `run_in_background: true`. Start with 2-4 workers, queue additional units, and respect configured concurrency.
- Default to read-only delegation. Allow concurrent writes only with disjoint ownership and no dependencies. Keep shared, generated, uncertain, and dependency-ordered work serial.
- Workers must not claim additional work, delegate, or expand scope. Stop before editing an unowned path or making a shared design decision.
- Require results with `status`, `summary`, `evidence`, `changed_files`, `validation`, `blockers`, and `recommended_next_action`.
- After each wave, compare actual changes with ownership, validate each unit, preserve failures and contradictions, resolve shared work serially, and run the final acceptance check. Treat delegated results as evidence, not proof.

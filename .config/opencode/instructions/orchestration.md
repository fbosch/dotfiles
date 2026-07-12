# Agent Orchestration

| Agent              | Usually helpful for                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `adversarial`      | Stress-testing a design or implementation for failure modes and abuse cases                                              |
| `analyze`          | Explaining how existing code works with precise file and line references                                                 |
| `backlog-planning` | Turning rough ideas, specs, or issue text into a task plan                                                               |
| `benchmark`        | Performance measurement, profiling, before/after comparisons                                                             |
| `debug`            | Root-cause analysis, logs, failing commands, unexpected behavior                                                         |
| `docs`             | Documentation is the main deliverable                                                                                    |
| `explore`          | Broad codebase discovery, locating relevant files, or answering where/how something is implemented                       |
| `ideate`           | Generating options, alternatives, and directions before converging                                                       |
| `patterns`         | Finding existing examples, conventions, or prior implementations to copy from                                            |
| `quick`            | Well-scoped, deterministic work: fetch-and-format tasks, small localized edits, focused cleanup, lightweight repo checks |
| `refactor`         | Improving structure or readability without changing behavior                                                             |
| `research`         | Source-backed investigation across docs, web, and code without making changes                                            |
| `review`           | Findings are the main output: code review, PR review, risk audit                                                         |
| `spec`             | Turning a request into an explicit contract before implementation                                                        |
| `test`             | Writing, running, or diagnosing tests and coverage                                                                        |

## Routing Rules

- Delegate only when specialization, isolated context, or parallel execution provides a clear benefit.
- Continue directly for small answers, obvious edits, narrow inspections, and work already understood in the primary context.
- Do only enough initial discovery to identify scope and choose an agent; do not duplicate the investigation being delegated.
- Use the fewest agents needed. Give each agent a distinct, non-overlapping question or deliverable.
- Run independent work in parallel. Run dependent work sequentially and pass relevant findings forward.
- Give each agent the user intent, known context, scope, whether it may modify files, required validation, and expected final output.
- Reuse an agent's `task_id` for follow-up work on the same problem.
- Integrate and verify completed agent work rather than repeating it, unless evidence conflicts with it.
- Do not delegate trivial validation commands unless their output needs interpretation or follow-up changes.

## Agent Boundaries

- `ideate` generates alternatives before a direction is chosen; `spec` defines the behavioral contract; `backlog-planning` decomposes an established direction or specification into deliverable work.
- `analyze` explains known code; `explore` locates unknown code; `patterns` finds precedents; `debug` diagnoses observed failures.
- `review` audits an implementation; `adversarial` actively searches for ways a design or implementation can fail.
- `research` gathers source-backed external evidence without making changes.
- `docs` owns substantial documentation deliverables; `test` owns non-trivial test creation or diagnosis.
- `quick` is only for deterministic, tightly scoped execution. Do not use it where judgment, contract design, or substantial prose is the deliverable.

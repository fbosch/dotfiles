# OpenCode Subagent Routing

| Agent              | Usually helpful for                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `adversarial`      | Stress-testing a design or implementation for failure modes and abuse cases                                              |
| `analyze`          | Explaining how existing code works with precise file and line references                                                 |
| `backlog-planning` | Turning rough ideas, specs, or issue text into a task plan                                                               |
| `benchmark`        | Performance measurement, profiling, before/after comparisons                                                             |
| `debug`            | Root-cause analysis, logs, failing commands, unexpected behavior                                                         |
| `docs`             | Documentation is the main deliverable                                                                                    |
| `explore`          | Fast, read-only discovery: locating files, symbols, and relevant code areas                                               |
| `general`          | Complex multi-step implementation or mixed work that does not fit a narrower specialist                                  |
| `ideate`           | Generating options, alternatives, and directions before converging                                                       |
| `lookup`           | Narrow, verified online reference retrieval using available documentation and search tools                              |
| `patterns`         | Finding existing examples, conventions, or prior implementations to use as references                                   |
| `pr-feedback`      | Triaging existing GitHub PR review threads, validating claims, applying approved fixes, and resolving approved threads   |
| `quick`            | Tightly scoped, well-specified work: fetch-and-format tasks, small edits, focused cleanup, lightweight repo checks       |
| `refactor`         | Improving structure or readability without changing behavior                                                             |
| `research`         | Source-backed investigation across docs, web, and code without making changes                                            |
| `review`           | Findings are the main output: code review, PR review, risk audit                                                         |
| `spec`             | Turning a request into an explicit contract before implementation                                                        |
| `test`             | Writing, running, or diagnosing tests and coverage                                                                        |
| `validate`         | Bounded, read-only post-change validation with targeted checks and explicit evidence                                     |

## Routing Rules for Primary Agents with the Task Tool

- Delegate only when specialization, isolated context, or parallel execution provides a clear benefit.
- Continue directly for small answers, obvious edits, narrow inspections, and work already understood in the primary context.
- Do only enough initial discovery to identify scope and choose an agent; do not duplicate the investigation being delegated.
- Use the fewest agents needed. Give each agent a distinct, non-overlapping question or deliverable.
- Run independent work in parallel. Run dependent work sequentially and pass relevant findings forward.
- Give each agent the user intent, known context, scope, whether it may modify files, required validation, and expected final output.
- When continuing the same delegated task, reuse its returned `task_id`; start a fresh task for a distinct question or when no ID was returned.
- Integrate and verify completed agent work rather than repeating it, unless evidence conflicts with it.
- Run one obvious validation command directly; use `validate` for a bounded post-change pass across several targeted checks.

## Agent Boundaries

- `ideate` expands alternatives before a direction is chosen; `spec` defines the behavioral contract; `backlog-planning` turns sufficiently scoped input into verifiable tasks and flags when a spec is still needed.
- `analyze` explains known code; `explore` locates unknown code; `patterns` finds precedents; `debug` diagnoses observed failures.
- `review` audits an implementation; `adversarial` actively searches for ways a design or implementation can fail.
- `pr-feedback` handles existing reviewer threads; `review` performs an independent PR or code review, and `quick` handles generic, well-specified workflows.
- `validate` runs bounded post-change checks; `test` owns test design, coverage, and test-failure diagnosis; `debug` owns unexplained runtime, command, environment, or product failures; `review` owns risk assessment.
- Use `lookup` for one narrow external-reference question; use `research` for multi-source investigation and synthesis.
- `docs` owns substantial documentation deliverables.
- `quick` is only for tightly scoped, well-specified execution with explicit acceptance criteria. Do not use it where substantial judgment, contract design, or prose is required.

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

## Guardrails

- Do not delegate for small direct answers, single-file inspections, obvious edits, or when the primary context already contains enough evidence.
- Use subagents when the request benefits from isolated investigation, broad discovery, specialized review, or parallel work.
- Before delegating, do enough narrow reading/searching to confirm scope and choose the right route. Continue directly when the work is small, local, or already well-scoped.
- Do not use `quick` for detailed specification work, documentation writing, or other deliverables where depth, nuance, or contract-shaping matters.
- Prefer `spec` for specs and `docs` for documentation.
- Use `research` for source-backed investigation across external docs, web, GitHub, or unfamiliar codebases when citations or provenance matter.
- Use `test` for test-writing, coverage improvement, non-trivial test-suite runs, and diagnosing test failures.
- Do not delegate trivial validation commands unless the test output needs interpretation or follow-up changes.
- Disambiguate: `analyze` explains known code; `explore` finds unknown code; `patterns` finds conventions; `debug` investigates failures.

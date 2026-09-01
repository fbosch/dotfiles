# Subagent Routing

Use subagents when specialization or isolated context improves the result. Work
directly for small answers, obvious edits, narrow inspections, and work already
understood in the parent session.

## Agent Selection

| Agent              | Use for                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `adversarial`      | Concrete break scenarios, malicious inputs, stress cases, and failure-mode analysis        |
| `analyze`          | Evidence-backed code-path, data-flow, call-chain, and state-transition explanations        |
| `backlog-planning` | Dependency-aware task backlogs from rough ideas, specs, or issue text                      |
| `benchmark`        | Baselines, profiles, and comparable before/after performance measurements                  |
| `commit`           | Strict JSON commit-message metadata from context supplied by the parent                    |
| `debug`            | Reproducing failures, testing hypotheses, and identifying root causes                      |
| `docs`             | Documentation deliverables and substantial prose changes                                   |
| `explore`          | Fast, read-only repository discovery                                                       |
| `ideate`           | Expanding and ranking materially different options before convergence                      |
| `lookup`           | One narrow external fact or documentation lookup with source URLs                          |
| `patterns`         | Existing implementations, examples, and conventions in the repository                      |
| `pr-feedback`      | GitHub review-thread triage and approved fixes; expect parent-mediated approval steps      |
| `quick`            | Tightly scoped execution with explicit constraints and acceptance criteria                 |
| `refactor`         | Behavior-preserving simplification and structural cleanup                                  |
| `research`         | Multi-source investigation and synthesis without file changes                              |
| `review`           | Severity-ordered code, security, performance, and maintainability findings                 |
| `spec`             | Explicit behavior, interface, invariant, failure, and readiness contracts                  |
| `test`             | Test design, implementation, execution, and failure diagnosis                              |
| `tutor`            | User-requested coaching and deliberate practice; relay each interaction through the parent |
| `validate`         | Bounded, read-only post-change checks and evidence                                         |
| `general-purpose`  | Complex implementation or mixed work that does not fit a narrower role                     |

## Delegation Rules

- Do only enough discovery to select the role and write a complete task. Do not
  duplicate the child's investigation.
- Give every child the user intent, known context, exact scope, edit authority,
  validation requirement, and expected final output. Children do not inherit
  the parent conversation unless `inherit_context` is explicitly enabled.
- Prefer `fffind` for file discovery and `ffgrep` for identifier or literal
  search. Use Pi's built-in `find` and `grep` as fallbacks, then read the source
  once the relevant paths are known.
- Use the fewest children needed. Children cannot spawn other children; the
  parent owns decomposition, sequencing, and integration.
- Use a foreground child for one result that blocks the next parent action. Use
  background execution only when the parent has independent work to continue.
- `maxConcurrent: 1` serializes background children. Never use foreground runs
  to evade that resource limit.
- Resume the same child by its agent ID when continuing its work. Start a new
  child for a distinct question or deliverable.
- If a child returns `Parent approval required:` or `Parent handoff required:`,
  obtain the decision or complete the named parent task, then resume that child
  with the result. Do not silently substitute a new child.
- Prefer child-scoped permission approval. Do not grant a whole-session rule to
  bypass an agent denial or avoid repeated review.
- A child cannot be stopped individually through the current tool contract.
  Steer it to wrap up when practical; interrupting the parent aborts every
  running and queued child because `abortAllOnInterrupt` is enabled.
- Inspect every child result and resulting diff. Run one direct integration
  check before reporting success; delegated validation is evidence, not proof.

## Agent Boundaries

- `ideate` expands options, `spec` defines the contract, and
  `backlog-planning` turns scoped input into verifiable tasks.
- `analyze` explains a known code path, `explore` locates unknown code, and
  `patterns` finds precedents. `debug` owns an observed failure.
- `review` audits an implementation. `adversarial` actively tries to break it.
- `pr-feedback` handles existing reviewer threads. `review` performs an
  independent review.
- `validate` runs bounded checks. `test` owns test design and failure diagnosis.
  `debug` owns unexplained runtime or environment failures.
- Use `lookup` for one narrow external question and `research` for multi-source
  investigation or tradeoff analysis.
- Use `quick` only when scope and acceptance criteria are explicit. Route
  substantial documentation to `docs`, contracts to `spec`, and mixed or
  cross-cutting implementation to `general-purpose`.

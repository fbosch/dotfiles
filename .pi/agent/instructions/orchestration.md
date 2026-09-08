# Subagent routing

Use `Task` when specialist expertise, isolated context, or independent parallel work clearly reduces effort. Work directly for simple answers, obvious edits, narrow inspections, and work already understood in the parent context.

Use each agent's frontmatter description for role selection. Available roles:
`adversarial`, `analyze`, `backlog-planning`, `benchmark`, `commit`, `debug`,
`docs`, `explore`, `general`, `ideate`, `lookup`, `patterns`, `pr-feedback`,
`quick`, `refactor`, `research`, `review`, `spec`, `test`, `tutor`, `validate`.

## Dispatch

- For discovery, use `fffind` for paths and `ffgrep` for identifiers or literals; use `find` and `grep` only as fallbacks, then read the source once paths are known.
- Discover only enough to choose a role; do not duplicate delegated investigation.
- Use the fewest agents needed, with distinct, non-overlapping deliverables. Children cannot spawn other children; the parent owns decomposition, sequencing, and integration.
- Include user intent, known context, exact scope, edit authority, validation requirements, and expected output. Children do not inherit the parent conversation unless `inherit_context` is enabled.
- Run independent work in parallel; use a foreground child for blocking work and background children only for independent work.
- Resume the same child by its returned `task_id`; start a new task for a distinct question or when no ID was returned.
- Handle `Parent approval required:` and `Parent handoff required:` responses before resuming the child. Do not silently substitute another child.
- Prefer child-scoped permission approval. Do not bypass an agent denial with a whole-session rule.
- A child cannot be stopped individually; steer it to wrap up when practical. Interrupting the parent aborts running and queued children.
- Inspect every child result and diff. Integrate and verify results rather than forwarding them unverified.
- Run one direct integration check before reporting success. Delegated validation is evidence, not proof.

## Boundaries

- `ideate` expands alternatives; `spec` defines the contract; `backlog-planning` turns scoped input into verifiable tasks.
- `explore` locates unknown code; `analyze` explains known code; `patterns` finds precedents; `debug` diagnoses observed failures.
- `review` independently audits; `adversarial` actively searches for failure modes.
- `pr-feedback` handles existing review threads.
- `validate` runs bounded checks; `test` owns test design, coverage, and test-failure diagnosis; `debug` owns unexplained runtime or environment failures.
- `lookup` answers one narrow external question; `research` synthesizes multiple sources.
- Use `quick` only for tightly scoped work with explicit acceptance criteria. Route substantial documentation to `docs`, contracts to `spec`, and mixed or cross-cutting implementation to `general`.

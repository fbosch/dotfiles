# Validation and Execution Reference

## Evidence and Verification

- Gather evidence proportional to risk: trivial edits need local context; behavior/API/infra changes require tracing execution paths and regression surface before editing.
- If validation fails after a change, make one targeted fix when root cause is clear; otherwise stop and report failure and validation gaps.

## Ambiguity and Execution Loop

- Before coding, state key assumptions; if any assumption is high-impact, ask one targeted question.
- For non-trivial tasks, define success criteria first (tests/checks/observable outcome), then implement until criteria pass.
- If unrelated dead code or issues are noticed, mention them; do not modify unless requested.
- Scope lint/typecheck diagnostics to files you touched first; widen only if needed.
- If a scoped `AGENTS.md` or referenced workflow doc names validation checks, run them after changes and before finishing.
- Tiny implementations still need evidence proportional to risk; do not skip validation solely because the code is short.
- Prefer one targeted check that exercises the changed behavior over broad validation that adds noise without new evidence.
- If intentionally leaving a `shortcut:` path, validate the current path and state the deferred trigger clearly.

## Done Criteria

- Before declaring completion, include the validation that ran or explicitly list validation gaps.

# Validation and Execution Reference

## Evidence and Verification

- Never fabricate paths, APIs, config keys, env vars, capabilities, or test results; state uncertainty explicitly.
- Never weaken assertions, narrow scope, reduce coverage, or skip checks to force a pass.
- Gather evidence proportional to risk: trivial edits need local context; behavior/API/infra changes require tracing execution paths and regression surface before editing.
- If validation fails after a change, make one targeted fix when root cause is clear; otherwise stop and report failure and validation gaps.

## Ambiguity and Execution Loop

- Read the root `AGENTS.md` first; read deeper `AGENTS.md` files once target files or subtree are known.
- Before coding, state key assumptions; if any assumption is high-impact, ask one targeted question.
- If a request has multiple valid interpretations, list options with tradeoffs; do not pick silently.
- Treat follow-up requests as cumulative unless the user clearly resets scope.
- Prefer the simpler approach when it satisfies the request; push back on over-complex directions.
- For non-trivial tasks, define success criteria first (tests/checks/observable outcome), then implement until criteria pass.
- If unrelated dead code or issues are noticed, mention them; do not modify unless requested.
- Scope lint/typecheck diagnostics to files you touched first; widen only if needed.
- If a scoped `AGENTS.md` or referenced workflow doc names validation checks, run them after changes and before finishing.
- Run the smallest reasonable validation (tests/build/typecheck) when making code changes.

## Done Criteria

- Before declaring completion, confirm the requested problem is solved, relevant validation ran (or explicit gaps are listed), no known unintended side effects were introduced, and no secrets were added or exposed.

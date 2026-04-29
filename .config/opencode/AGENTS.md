# Preferences

## Decision priorities

- Prioritize in this order: correctness, evidence, safety, minimal changes, consistency, performance.

## Always-on guardrails

- Only commit, amend, rebase, push, or open PRs when explicitly asked; otherwise report proposed git actions without running them.
- Only run destructive or hard-to-reverse commands when explicitly asked and the target is unambiguous; if unsure, ask first.
- Do not add secrets to the repo; use env vars, placeholders, or redacted examples instead.
- Do not add dependencies, perform major upgrades, or create lockfile churn unless explicitly asked; prefer existing dependencies.
- Do not fabricate paths, APIs, config keys, env vars, capabilities, results, or file contents; if unverified, say what is unknown.
- Preserve Danish letters exactly (`æ`, `ø`, `å`); do not transliterate them to `ae`, `oe`, or `aa`.

## Operating defaults

- Keep changes minimal and local; prefer existing patterns.
- Prefer guard clauses and clear control flow over deep nesting.
- Default to current schema/contract; add compatibility layers only when explicitly required.
- Run the smallest reasonable validation for changed behavior.

## Communication style

- Skip affirmations and compliments (no "great question!" or "you're absolutely right!") - respond directly.
- Avoid trailing opt-in closers (no "if you want, I can..." / "would you like me to..."); take the obvious next step or ask one necessary clarifying question.
- Challenge flawed ideas openly; question assumptions and offer counterpoints.
- Omit language suggesting remorse or apology.
- Exclude personal ethics or morals unless explicitly relevant.
- Break down complexities into smaller steps with clear reasoning.
- Offer multiple viewpoints or solutions.
- Never convert or transliterate the Danish letters `ae`, `oe`, `aa` in place of `æ`, `ø`, `å`, or vice versa; preserve original Danish characters exactly.

## Coding style

- Prefer early returns/guard clauses; avoid deep nesting.
- Prefer early returns over `else` branches when flow can stay clear.
- Avoid deeply nested ternary operators; prefer clearer control flow.
- Keep changes minimal and local; avoid drive-by refactors and formatting.
- Favor small, focused functions/modules and clear names over cleverness.
- Prefer existing repo conventions/patterns over introducing new ones.
- Name meaningful magic numbers/strings (constants) and extract complex conditions into well-named helpers.
- Keep each unit focused on one job; separate decision logic from I/O (UI/network/fs).
- Prefer adding new code paths over modifying stable/shared code; avoid extension points without a concrete second use case.
- If using inheritance/interfaces, preserve contracts (no surprise behavior; no stricter inputs; no weaker outputs).
- Prefer small, purpose-built interfaces/types/props; avoid "god" interfaces.
- Keep core logic independent of frameworks/external services; inject dependencies and wrap external APIs behind adapters when it improves testability/coupling.
- Avoid single-use wrapper functions and trivial helper functions.
- Avoid IIFEs (immediately invoked function expressions); prefer named functions, top-level statements, or module-level initialization.
- Prefer `=== false` over `!` for negating boolean expressions, especially multi-line ones.
- Prefer event-driven listeners over polling loops whenever both are viable.

## Compatibility policy

- Implement requested behavior with minimal, direct changes.
- Do not preserve prior behavior unless backward compatibility is explicitly requested.
- Default to current schema/contract only.
- Add migration, shim, fallback, or dual-read/dual-write logic only when persisted old data or external consumers are explicitly in scope.
- If compatibility need is unclear and materially changes implementation, ask one short clarifying question before coding.
- Prefer fail-loud plus explicit validation at boundaries; do not hide failures with silent defaults.
- Keep a single source of truth for defaults; do not duplicate fallback defaults across layers.
- Any approved compatibility code requires tests and a clear removal condition.

## Avoid slop

- No redundant type annotations where inference works (`const x: string = "foo"` -> `const x = "foo"`).
- No type casts to `any` to bypass type issues; fix types properly.
- No explanatory comments for obvious code.
- No console.log or debug prints in committed code; remove temporary debug logs before finishing.
- No commented-out code blocks; delete or rely on git history.
- Match existing codebase verbosity for naming.
- Trust the type system; do not add runtime checks it already prevents.
- Add `try/catch` only where errors are expected and handleable.

## Evidence and verification

- Never fabricate paths, APIs, config keys, env vars, capabilities, or test results; state uncertainty explicitly.
- Never weaken assertions, narrow scope, reduce coverage, or skip checks to force a pass.
- Gather evidence proportional to risk: trivial edits need local context; behavior/API/infra changes require tracing execution paths and regression surface before editing.
- If validation fails after a change, make one targeted fix when root cause is clear; otherwise stop and report failure and validation gaps.

## Ambiguity and execution loop

- Read the root `AGENTS.md` first; read deeper `AGENTS.md` files once target files or subtree are known.
- Before coding, state key assumptions; if any assumption is high-impact, ask one targeted question.
- If a request has multiple valid interpretations, list options with tradeoffs; do not pick silently.
- Treat follow-up requests as cumulative unless the user clearly resets scope.
- Prefer the simpler approach when it satisfies the request; push back on over-complex directions.
- For non-trivial tasks, define success criteria first (tests/checks/observable outcome), then implement until criteria pass.
- If unrelated dead code or issues are noticed, mention them; do not modify unless requested.
- Scope lint/typecheck diagnostics to files you touched first; widen only if needed.
- If a scoped `AGENTS.md` names validation checks, run them after changes and before finishing.
- Run the smallest reasonable validation (tests/build/typecheck) when making code changes.

## Done criteria

- Before declaring completion, confirm the requested problem is solved, relevant validation ran (or explicit gaps are listed), no known unintended side effects were introduced, and no secrets were added or exposed.

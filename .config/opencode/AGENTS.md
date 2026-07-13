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
- Default to current schema/contract; add compatibility layers only when explicitly required.
- Run the smallest reasonable validation for changed behavior.
- Read references on demand; do not load all of them by default.
- Before changing behavior, APIs, config formats, data handling, or validation paths, read `~/.config/opencode/references/compatibility.md`.
- Before running or reporting validation, read `~/.config/opencode/references/validation.md`.
- Before substantial user-facing prose, PR descriptions, issue summaries, or docs, read `~/.config/opencode/TONE.md`.
- Skip reference reads for trivial answers, single-line edits, or when the same reference has already been read for the current task.
- If unsure whether a task is non-trivial, prefer reading the narrowest relevant reference over guessing.

## Coding style

- Prefer early returns and guard clauses; avoid deep nesting and avoid `else` when flow can stay clear.
- Avoid deeply nested ternary operators; prefer clearer control flow.
- Favor small, focused functions/modules and clear names over cleverness.
- Prefer existing repo conventions and patterns over introducing new ones.
- Name meaningful magic numbers/strings and extract complex conditions into well-named helpers.
- Keep each unit focused on one job; separate decision logic from I/O when it improves clarity.
- Prefer adding new code paths over modifying stable/shared code; avoid extension points without a concrete second use case.
- Preserve contracts when using inheritance/interfaces: no surprise behavior, stricter inputs, or weaker outputs.
- Prefer small, purpose-built interfaces/types/props; avoid god interfaces.
- Keep core logic independent of frameworks/external services where practical; inject dependencies or wrap external APIs only when it improves testability/coupling.
- Avoid single-use wrapper functions, trivial helpers, and IIFEs.
- Prefer `=== false` over `!` for negating boolean expressions, especially multi-line ones.
- Prefer event-driven listeners over polling loops whenever both are viable.

## Simplicity ladder

- First ask whether the code needs to exist; no code is best when the requirement can be removed or handled operationally.
- Prefer stdlib APIs before custom code.
- Prefer native platform features before dependencies.
- Prefer existing dependencies before adding new dependencies.
- Prefer existing repo patterns before new architecture.
- Prefer one clear expression or small local block before scaffolding helpers, classes, adapters, or config.
- Only add abstraction when there is a concrete second use case or the implementation complexity is large enough to hide behind a stable interface.
- Do not simplify away authorization, security checks, observability needed to debug failures, or other required safeguards.
- When deliberately taking a shortcut, add `shortcut:` with the limitation and upgrade trigger.

## Avoid slop

- No redundant type annotations where inference works.
- No type casts to `any` to bypass type issues; fix types properly.
- No explanatory comments for obvious code.
- No console.log or debug prints in committed code; remove temporary debug logs before finishing.
- No commented-out code blocks; delete or rely on git history.
- Match existing codebase verbosity for naming.
- Trust the type system; do not add runtime checks it already prevents.
- Add `try/catch` only where errors are expected and handleable.
- No speculative compatibility layers, options, adapters, or extension points without a current caller.
- No avoidable dependency installs when stdlib, platform, or existing dependency coverage is enough.

## Communication style

- Skip affirmations and compliments (no "great question!" or "you're absolutely right!") - respond directly.
- Avoid trailing opt-in closers (no "if you want, I can..." / "would you like me to..."); take the obvious next step or ask one necessary clarifying question.
- Challenge flawed ideas openly; question assumptions and offer counterpoints.
- Omit language suggesting remorse or apology.
- Exclude personal ethics or morals unless explicitly relevant.
- Be concise, technical, and outcome-oriented; use fuller prose when ambiguity, security, destructive operations, or architecture tradeoffs require it.
- For substantial user-facing docs, README prose, PR descriptions, or long-form explanations, use the `writing-clearly` skill; `~/.config/opencode/TONE.md` remains the canonical voice reference.

## Evidence and verification

- Never fabricate paths, APIs, config keys, env vars, capabilities, or test results; state uncertainty explicitly.
- When asked about performance, do not guess metrics; offer to measure them and identify whether a baseline should be established first.
- Never weaken assertions, narrow scope, reduce coverage, or skip checks to force a pass.

## Ambiguity and execution loop

- Read the root `AGENTS.md` first; read deeper `AGENTS.md` files once target files or subtree are known.
- If a request has multiple valid interpretations, list options with tradeoffs; do not pick silently.
- Treat follow-up requests as cumulative unless the user clearly resets scope.
- Prefer the simpler approach when it satisfies the request; push back on over-complex directions.

## Done criteria

- Before declaring completion, confirm the requested problem is solved, relevant validation ran (or explicit gaps are listed), no known unintended side effects were introduced, and no secrets were added or exposed.

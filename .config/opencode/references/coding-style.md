# Coding Style Reference

## Core Style

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

## Avoid Slop

- No redundant type annotations where inference works (`const x: string = "foo"` -> `const x = "foo"`).
- No type casts to `any` to bypass type issues; fix types properly.
- No explanatory comments for obvious code.
- No console.log or debug prints in committed code; remove temporary debug logs before finishing.
- No commented-out code blocks; delete or rely on git history.
- Match existing codebase verbosity for naming.
- Trust the type system; do not add runtime checks it already prevents.
- Add `try/catch` only where errors are expected and handleable.

# Preferences

## Decision priorities

- Prioritize in this order: correctness, evidence, safety, minimal changes, consistency, performance.

## Always-on guardrails

- Never commit, amend, rebase, push, or open PRs unless explicitly asked.
- Never run destructive/irreversible commands unless explicitly asked.
- Never add secrets to the repo; use env vars and redaction.
- Avoid dependency changes (new deps, major bumps, lockfile churn) unless explicitly asked.
- Never fabricate paths, APIs, config keys, env vars, capabilities, or results.
- Preserve Danish letters exactly (`æ`, `ø`, `å`); never transliterate.

## Operating defaults

- Keep changes minimal and local; prefer existing patterns.
- Prefer guard clauses and clear control flow over deep nesting.
- Default to current schema/contract; add compatibility layers only when explicitly required.
- Run the smallest reasonable validation for changed behavior.

## Detailed references

- Communication: `references/communication.md`
- Coding style and anti-slop: `references/coding-style.md`
- Compatibility policy: `references/compatibility.md`
- Evidence, ambiguity loop, and done criteria: `references/validation.md`

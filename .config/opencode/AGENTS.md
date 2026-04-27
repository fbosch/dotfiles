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

Load these files only when their topic is relevant. Paths are relative to `$HOME`. When loaded, treat them as binding guidance.

- Communication: read `~/.config/opencode/references/communication.md` when drafting user-facing messages, reviews, PR text, docs, or long explanations.
- Coding style and anti-slop: read `~/.config/opencode/references/coding-style.md` before non-trivial code edits, refactors, UI/frontend work, or style-sensitive changes.
- Compatibility policy: read `~/.config/opencode/references/compatibility.md` before changing APIs, schemas, CLI flags, config formats, defaults, persisted data, or public behavior.
- Evidence, ambiguity loop, and done criteria: read `~/.config/opencode/references/validation.md` when requirements are unclear, behavior changes, validation is non-obvious, or before claiming work is complete.

# Move complex Fish logic to Bun TypeScript helpers

**Status:** accepted
**Date:** 2026-04-22

## Context

Several Fish functions in this dotfiles repo have grown into dense scripts with parsing, transformation, and stateful logic. That complexity makes them harder to test, reason about, and maintain as interactive shell code. We also now have working examples of Bun-powered helpers already integrated with Fish wrappers.

## Decision

Move complex business logic out of Fish functions into TypeScript helpers executed with Bun under `.config/fish/libexec/`. Keep Fish functions as thin wrappers responsible for CLI UX, prompts, argument validation, and orchestration. Prefer stable helper CLI contracts (clear args, machine-readable stdout, non-zero exit on error).

## Alternatives Considered

Keep all logic in Fish and only refactor structure within `.fish` files. This was rejected because Fish is less ergonomic for complex parsing and data modeling. Keep using Python helpers was also considered, but Bun/TypeScript aligns with existing repo direction and keeps helper tooling more consistent.

## Consequences

Fish functions become smaller and easier to read, while complex transforms become easier to lint, format, and type-check. We add a small runtime dependency on Bun for helper-backed commands. Migration should happen incrementally to preserve behavior parity and avoid regressions.

---
name: ts-pattern
description: TypeScript pattern matching with ts-pattern for exhaustive branching, data selection, and runtime shape checks. Use when implementing or refactoring conditionals over discriminated unions, tuple combinations, nested object shapes, reducer/state-machine transitions, or unknown input validation with `isMatching`, `P.infer`, `P.select`, and predicate patterns. Must use when the branching logic depends on structure rather than a small number of boolean checks.
---

# TS-Pattern

Use `ts-pattern` to make branching logic explicit, exhaustive, and type-directed.

## Decision workflow

1. Choose the branching tool before writing branches: use `if` for one or two trivial boolean checks, a lookup table for stable key-to-result mappings, and `match(...)` when behavior depends on shape, literals, tuple combinations, or nested data.
2. Prefer `.exhaustive()` for closed unions and known tuple spaces. Use `.otherwise(...)` only when a real fallback is part of the behavior.
3. Match structurally first: literals, object shapes, tuples, `P.union`, `P.not`, `P.nullish`, `P.nonNullable`. Add `P.when(...)` only for logic that cannot be expressed structurally.
4. Use `P.select(...)` when the handler only needs a nested value. Keep handlers focused on producing the result, not re-navigating the input.
5. Add `.returnType<T>()` when branch return values start drifting or inference becomes wider than the intended API. Reach for `.narrow()` only after earlier branches intentionally carve away part of a larger union.
6. For runtime validation of unknown data, define reusable patterns and use `isMatching(...)`. If the pattern is the source of truth, derive the static type with `P.infer`.

## Default patterns

### Closed unions

Use one branch per meaningful case and end with `.exhaustive()`.

```ts
import { match } from 'ts-pattern';

type Result =
  | { type: 'ok'; data: string }
  | { type: 'error'; message: string }
  | { type: 'loading' };

const render = (result: Result) =>
  match(result)
    .with({ type: 'ok' }, ({ data }) => data)
    .with({ type: 'error' }, ({ message }) => message)
    .with({ type: 'loading' }, () => 'Loading...')
    .exhaustive();
```

### State + event reducers

Match `[state, event]`, not nested switches. Use `.returnType<State>()` when the reducer must stay exact.

If you are implementing a reducer, state machine, or transition table, load `references/recipes.md` before editing. Do not load it for simple union rendering.

### Unknown input validation

Define a pattern once, reuse it with `isMatching`, and derive types from it when that reduces duplication.

If you are validating unknown input or parsing collection-heavy data, load `references/recipes.md` for validation examples and `references/pattern-catalog.md` for collection matchers and helper patterns.

## NEVER list

- NEVER use `.otherwise(...)` on a closed union just to silence missing cases; use `.exhaustive()` and handle the real missing branch.
- NEVER put `P._` before specific cases; it makes the rest of the match unreachable and hides ordering mistakes.
- NEVER reach for `P.when(...)` if a literal, object, tuple, `P.union(...)`, or built-in matcher already expresses the condition; structural patterns narrow better and keep the decision table readable.
- NEVER dump large business logic blocks into handlers; the match should read like a decision table, not hide work in branch-local imperative code.
- NEVER use `.run()` unless you intentionally accept runtime failure instead of compile-time exhaustiveness.
- NEVER introduce `ts-pattern` where a plain lookup table or a single guard clause is clearer; extra abstraction hurts more than it helps in simple flows.

## Load references as needed

- Load `references/recipes.md` for reducers, validation, tuple matching, and selection recipes.
- Load `references/pattern-catalog.md` for `P.select`, predicates, collection matchers, `.narrow()`, and return-type control.
- Do not load either reference file for a small closed union unless the first pass reveals tuple matching, repeated nested selections, or unknown-input validation.

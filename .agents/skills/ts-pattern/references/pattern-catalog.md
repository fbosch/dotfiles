# TS-Pattern Catalog

## Contents

- Structural matchers
- Predicates and refinements
- Collections
- Return types and narrowing

## Structural matchers

- `P.union(...)`: merge several structural cases into one branch without losing narrowing.
- `P.not(...)`: express a negative constraint when the excluded value matters.
- `P.nullish`: match `null | undefined`.
- `P.nonNullable`: require a present value.
- `P.optional(subpattern)`: match optional object properties.

Prefer these before `P.when(...)` because they keep the match declarative, preserve stronger narrowing, and make branch order easier to scan.

## Predicates and refinements

- `P.when(predicate)`: use for conditions that cannot be described structurally.
- Type-guard predicates narrow the handler input further.
- `P.string.startsWith(...)`, `.endsWith(...)`, `.includes(...)`, `.regex(...)`: keep common string tests inside the pattern.
- `P.number.gt(...)`, `.gte(...)`, `.lt(...)`, `.between(...)`, `.positive()`, `.negative()`, `.int()`, `.finite()`: keep numeric constraints inside the pattern.

Use predicate patterns for value properties, not for business workflows. If the handler starts reading like a second matcher, move that logic back into the pattern. If a predicate is doing all the real work, `match(...)` is probably the wrong tool.

## Collections

- `P.array(subpattern)`: match homogeneous arrays or variadic tuple tails.
- `P.record(keyPattern, valuePattern)` or `P.record(valuePattern)`: match object maps.
- `P.set(subpattern)`: require every set element to match.
- `P.map(keyPattern, valuePattern)`: require every map entry to match.

These are useful for validation and parsing boundaries. For ordinary iteration, filtering, or aggregation, use normal collection methods instead of forcing everything through `match`.

## Return types and narrowing

- `.returnType<T>()`: lock branch outputs to the API you intend to return.
- `.narrow()`: refine the remaining input space after earlier branches when working with larger unions.
- `P.infer<typeof pattern>`: derive a static type from a reusable validation pattern.

Use `.returnType<T>()` when inference becomes too wide, especially in reducers and formatter functions. Use `.narrow()` when earlier branches intentionally remove part of a larger union and the remaining branch space should stay precise.

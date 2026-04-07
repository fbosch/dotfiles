---
name: api-and-interface-design
description: Design stable API and interface contracts. Use when creating or changing endpoints, public types, config formats, or module boundaries consumed by other code or teams.
---

# API and Interface Design

Define contracts that are explicit, testable, and hard to misuse.

## Use when

- Designing or modifying REST/GraphQL/RPC endpoints
- Defining module interfaces or public TypeScript types
- Introducing config schemas, CLI arguments, or protocol payloads
- Reviewing compatibility impact of contract changes

## Contract checklist

- Inputs and outputs are explicit and versionable.
- Error semantics are consistent and machine-readable.
- Boundary validation is defined for all untrusted data.
- Pagination/filtering/sorting rules are explicit for list operations.
- Naming is predictable across fields, params, and status values.
- Invariants and side effects are documented.

## Compatibility rules

- Prefer additive changes over type/behavior mutations.
- Preserve existing fields/behaviors during migration windows.
- Mark deprecated fields with replacement guidance and timeline.
- Avoid leaking implementation details into public contracts.

## Validation boundaries

- Validate at system edges (requests, external responses, env/config load).
- Keep internal boundaries lean once data is validated.
- Treat third-party responses as untrusted until checked.

## Output contract

Return:

1. `Contract proposal`
2. `Alternatives considered`
3. `Compatibility impact`
4. `Validation strategy`
5. `Test implications` (contract and back-compat coverage)

## Done when

- Contract behavior is deterministic.
- Compatibility implications are explicit.
- Consumers can implement against the interface without reading internals.

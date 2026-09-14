---
name: api-and-interface-design
description: Contract-first API and interface design for stable integrations. Use when creating or changing endpoints, public types, config formats, module boundaries, error models, pagination contracts, or versioned compatibility behavior.
---

# API and Interface Design

Define contracts that are explicit, testable, and hard to misuse.

## Use when

- Designing or modifying REST/GraphQL/RPC endpoints
- Defining module interfaces or public TypeScript types
- Introducing config schemas, CLI arguments, or protocol payloads
- Reviewing compatibility impact of contract changes

## Compatibility scope gate

Before choosing a compatibility layer, identify the concrete compatibility obligation:

- an explicitly requested compatibility requirement
- an explicitly scoped external consumer
- persisted old data that must still be read or migrated
- an existing compatibility commitment, such as a published contract or rollout promise

Do not infer an obligation from a contract change alone. If all consumers are internal and coordinated, update them and replace the contract atomically instead of adding a shim, dual path, or staged migration. If the scope is unclear and the choice would materially change the implementation, ask for clarification.

Follow the compatibility reference: do not preserve prior behavior by default, and add migration, fallback, or dual-read/dual-write logic only for an obligation that is explicitly in scope.

## Design prompts

Before selecting a contract shape, ask:

- Which behaviors are consumers likely to accidentally depend on?
- Which fields are likely to expand in cardinality, size, or enum values?
- What can be additive versus what forces a compatibility boundary?
- Which errors must be machine-actionable for clients?

## Change decision matrix

- `Add optional field` -> when semantics are unchanged and old clients can ignore safely.
- `Add endpoint/operation` -> when behavior is new but existing contracts remain valid.
- `New version or compatibility mode` -> when semantics, required fields, ordering, or error meaning changes and explicitly scoped external consumers, persisted old data, or a compatibility commitment require coexistence.
- `Deprecation path required` -> when removing or renaming fields, or changing defaults with consumer-visible impact, for that same explicitly scoped compatibility obligation.
- `Coordinated internal replacement` -> when all consumers can be updated and validated atomically; do not add staged compatibility solely for internal coordination.

## Contract checklist

- Inputs and outputs are explicit and versionable.
- Error semantics are consistent and machine-readable.
- Boundary validation is defined for all untrusted data.
- Pagination/filtering/sorting rules are explicit for list operations.
- Naming is predictable across fields, params, and status values.
- Invariants and side effects are documented.

## Compatibility rules

For an explicitly scoped compatibility obligation:

- Prefer additive changes over type or behavior mutations.
- Preserve existing fields and behaviors during the migration window.
- Mark deprecated fields with replacement guidance and a timeline.

For coordinated internal consumers, prefer one atomic replacement and update all call sites in the same change.

- Avoid leaking implementation details into public contracts.

## Concrete contract patterns

- Error model: stable machine code + human message + optional details object (`code`, `message`, `details`).
- Pagination: explicit cursor/token contract or page/pageSize with documented stability and ordering guarantees.
- Deprecation marker: include replacement field/operation and sunset timeline in docs and warnings when a compatibility window is in scope.

## Validation boundaries

- Validate at system edges (requests, external responses, env/config load).
- Keep internal boundaries lean once data is validated.
- Treat third-party responses as untrusted until checked.

## NEVER do this

- Never change error semantics silently (same status/code, different meaning).
- Never overload one field with multiple semantic modes based on hidden context.
- Never make enum narrowing changes without a compatibility strategy when an external consumer, persisted data, or commitment is in scope.
- Never rely on undocumented ordering as part of client-visible behavior.
- Never ship pagination without deterministic ordering guarantees.
- For explicitly scoped external consumers, persisted old data, or compatibility commitments, never rename or remove fields without a deprecation window and migration path.

## Output contract

Return:

1. `Contract proposal`
2. `Alternatives considered`
3. `Compatibility impact`
4. `Validation strategy`
5. `Test implications` (contract and back-compat coverage when compatibility scope is explicit)

## Done when

- Contract behavior is deterministic.
- Compatibility implications are explicit for the selected scope.
- Consumers can implement against the interface without reading internals.

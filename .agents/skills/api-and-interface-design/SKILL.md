---
name: api-and-interface-design
description: Contract-first API and interface design. Use when creating or changing endpoints, public types, config schemas, CLI arguments, protocol payloads, module boundaries, error models, pagination contracts, or versioned compatibility behavior.
---

# API and Interface Design

## Compatibility scope gate

Before choosing a compatibility layer, identify the concrete compatibility obligation:

- an explicitly requested compatibility requirement
- an explicitly scoped external consumer
- persisted old data that must still be read or migrated
- an existing compatibility commitment, such as a published contract or rollout promise

Do not infer an obligation from a contract change alone or preserve prior behavior by default. Add compatibility mechanisms only to satisfy an obligation identified here. If scope is unclear and the choice would materially change the implementation, ask for clarification.

## Design prompts

Before selecting a contract shape, ask:

- Which behaviors are consumers likely to accidentally depend on?
- Which fields are likely to expand in cardinality, size, or enum values?
- What can be additive versus what forces a compatibility boundary?
- Which errors must be machine-actionable for clients?

## Change decision matrix

- `Add optional field` -> when semantics are unchanged and old clients can ignore it safely.
- `Add endpoint/operation` -> when behavior is new but existing contracts remain valid.
- `New version or compatibility mode` -> when changed semantics, required fields, ordering, or error meanings require coexistence under the scoped obligation.
- `Migration plan` -> when a breaking change affects a scoped obligation, including field removal, renaming, enum narrowing, or changed defaults. Choose a plan that satisfies that obligation: an agreed breaking release, coordinated data migration, or deprecation window. For a window, preserve promised behavior and document the replacement and sunset timeline.
- `Coordinated internal replacement` -> update all call sites in one change only when incompatible versions cannot overlap or the rollout prevents overlap. Same-repository ownership is insufficient: check deployment order, long-lived clients, queued messages, and stored values before assuming atomic replacement.

## Contract checklist

- Specify input and output field types, required versus optional fields, defaults, and absent versus null semantics.
- Define unknown-field handling: reject, ignore, or preserve.
- Identify which failures callers can retry or otherwise handle; give those outcomes distinct machine-readable meanings.
- For list operations, define filtering and sorting behavior, including default order and tie-breaking.
- Reuse established names for the same concepts across fields, parameters, and status values.
- Document invariants and externally observable side effects without exposing implementation details callers should not depend on.

## Concrete contract patterns

- Errors: use the protocol's established representation rather than imposing a new envelope. Where none exists, `code`, `message`, and optional `details` are one option. Typed module interfaces can use discriminated result variants without separate string-code fields.
- Pagination: define the cursor/token or page/pageSize contract and deterministic ordering. A unique tie-breaker does not prevent skips or duplicates when data changes between requests: specify snapshot versus live-dataset behavior and the effect of concurrent inserts or updates. For cursors, define whether they are bound to filters and sort order and what happens when those parameters change.

## Validation boundaries

- Validate untrusted data at system edges, including requests, third-party responses, and env/config load.
- Keep internal boundaries lean once data is validated.

## Contract hazards

- When error semantics change, including reuse of the same status/code with a different meaning, document the change and assess affected consumers against the compatibility scope gate.
- Never overload one field with multiple semantic modes based on hidden context.

## Output contract

For design proposals, cover:

1. `Contract proposal`
2. `Alternatives considered`
3. `Compatibility impact`
4. `Validation strategy`
5. `Test implications` (contract and back-compat coverage when compatibility scope is explicit)

For implementation work, report the contract delta, affected consumers, and validation performed or still missing. Use the full proposal structure only when the task requires design decisions.

## Done when

A caller can construct valid inputs and handle outputs and failures using only the contract, without reading implementation internals.

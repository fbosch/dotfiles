# Extract the Layout Intent Module

## Problem

`layouts/shared/order_state.lua` (720 lines) mixed two distinct concerns:

- **Order/position tracking** — per-instance state from `M.new()`, consumed by
  the layout modules via `sync`, `targets_from_order`, `move_active`,
  `remember_position`, and friends.
- **Intent tracking** — module-global state, consumed by `ordered_axis.lua`
  and produced by `lib/window/directional.lua` (transfer) and
  `lib/window/custom_layout.lua` (placement).

The intent *type* leaked across three modules: `TransferIntent` was documented
in `directional.lua`, the placement-intent shape was built in `custom_layout.lua`,
and both were stored/consumed in `order_state.lua`. To understand
`consume_transfer_intent` you had to read the producer, not the consumer.

The intent tracking also has real hidden complexity — transfer intents keep a
dual index (by window id and by destination role/axis) with a destination
fallback path — buried at the top of a 720-line module.

## Decision

Extract `layouts/shared/intents.lua` owning the whole intent concern:

- transfer intent: `record_transfer_intent`, `consume_transfer_intent`,
  `consume_transfer_intent_by_id`, `has_transfer_intent`,
  `transfer_intent_for_window`.
- placement intent: `record_placement_intent`, `consume_placement_intent`,
  `placement_intent_for_window`.
- floating-drag: `observe_floating_active`, `consume_tiled_drag`.
- the `TransferIntent` and `PlacementIntent` type annotations.

`intents.lua` depends one-way on `order_state.lua` for the identity helpers
(`window_id`, `target_id`, `index_of`); `order_state.lua` no longer references
any intent function, so there is no cycle.

The module is named `intents` (plural) because `intent` is already the
pervasive local name for a single intent object across producers, consumers,
and tests.

## Implementation

1. Create `layouts/shared/intents.lua` with the moved functions, retargeting
   `M.window_id`/`M.target_id`/`M.index_of` to `order_state.*`.
2. Remove the intent cluster from `order_state.lua` (module-global state,
   transfer-destination helpers, and the record/consume/drag functions).
3. Update producers: `directional.lua` (require `intents` instead of
   `order_state`), `custom_layout.lua` (add `intents`, keep `order_state` for
   `window_id`).
4. Update consumers: `ordered_axis.lua`, `portrait_rows.lua`,
   `ultrawide_master.lua` (add `intents`, keep `order_state`).
5. Update `benchmarks/hotpaths.lua` and the three layout specs; reset
   `package.loaded["layouts.shared.intents"]` alongside `order_state` so the
   module-global intent state does not leak between test cases.

## Validation

1. `busted --lua=luajit` full suite: 214 successes, 0 failures.
2. `lua-language-server --check` on `.config/hypr`: no problems found.
3. `stylua --check` clean on all changed files.

## Success Criteria

- Intent tracking has exactly one home; its type is defined where it is
  consumed.
- `order_state.lua` shrank 720 → 543 lines and holds only order/position state.
- Intent state still resets between test cases (no cross-test leakage).
- Producers and consumers keep the same function names; only the module
  changed from `order_state` to `intents`.

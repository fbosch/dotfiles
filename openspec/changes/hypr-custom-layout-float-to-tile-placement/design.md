## Context

The existing custom layouts already retain ordered target identities and expose
layout messages for cursor-based reordering. The direct `SUPER+V` bind invokes
Hyprland's float dispatcher without preserving the pre-toggle geometry, so a
float-to-tile transition has no explicit insertion policy.

See `proposal.md` and the capability specification for the intended behavior.

## Goals / Non-Goals

**Goals:**

- Preserve a floating window's coordinate on the active custom layout axis.
- Select an insertion index from the actual post-entry slot geometry.
- Make the request deterministic, one-shot, and bounded in lifetime.
- Preserve current behavior for all other float toggles.

**Non-Goals:**

- Altering ratios, normal spawned-window insertion, drag placement, or
  cross-monitor transfer insertion.
- Generalizing custom-layout discovery beyond `portrait_rows` and
  `ultrawide_master`.
- Choosing a slot from the cursor position or the window's top-left corner.

## Decisions

### Capture the source coordinate before toggling float state

The bind action will inspect the active window before dispatching the float
toggle. For a floating window on a custom layout, it records the center on the
layout axis along with the stable window identity and layout context.

This is necessary because after tiling, the compositor replaces the floating
geometry with the layout-assigned box. A layout callback alone cannot reliably
recover the source coordinate.

Alternative considered: dispatch the float toggle and then send the existing
`place-at-cursor` message. This uses the cursor rather than the window's
position and depends on dispatcher/recalculation ordering.

### Compare the captured coordinate with post-entry slot centers

The destination layout determines the target count and applicable ratios first.
It derives the center coordinate of every slot that would exist with the new
target, then chooses the index with the smallest absolute distance from the
captured window center. Equal distances retain the first index encountered,
which is leftmost/topmost.

The target is inserted at the selected index in the persistent order before
placement. Existing tiled targets retain their relative order.

Alternative considered: pick the slot containing the coordinate. Slot widths
and heights can be unequal, making containment produce a different and less
literal result than nearest-center placement.

### Use a one-shot placement intent, separate from transfer intents

The shared ordering state will hold a pending float-to-tile intent keyed by
window identity and scoped to layout name, workspace key, monitor role, and
axis. Layout recalculation consumes it before ordinary append or
geometry-based-reorder logic.

The intent expires after a short bounded delay and is also cleared after a
matching consumption. This prevents a failed or interrupted toggle from
changing a later layout transition.

Alternative considered: extend cross-monitor transfer intent. Its edge-only
model intentionally ignores source geometry, so combining the two would weaken
that contract and make stale state harder to reason about.

### Keep direct dispatcher behavior as the fallback

The wrapper invokes the same float toggle when it cannot safely record an
intent. It does not synthesize positions, infer missing geometry, or override
non-custom-layout behavior.

Alternative considered: block toggling when placement data is incomplete. That
would make a basic float toggle fail for an enhancement that is optional.

## Risks / Trade-offs

- [The layout recalc may not happen immediately] -> Keep the intent in shared
  state until a matching recalc consumes it, with a short expiration window.
- [Slot ratios can change when the target count changes] -> Calculate centers
  from the resulting count's ratios rather than prior slot geometry.
- [A compositor snapshot can lack identity or geometry] -> Use normal float
  toggling rather than guessing an insertion point.
- [The timer API is unavailable in a test or constrained runtime] -> Isolate
  expiration behind the existing timer capability and test consumption; the
  production path must use a bounded expiration mechanism.

## Migration Plan

1. Add focused tests for captured centers, nearest-slot selection, tie-breaking,
   and fallback behavior.
2. Add the scoped, expiring placement intent to shared layout ordering state.
3. Route `SUPER+V` through the layout-aware action.
4. Consume the intent in both custom layouts before normal ordering decisions.
5. Run focused Lua tests, Lua quality checks, and `hyprctl configerrors`.

Rollback is local: restore the direct float dispatcher bind and remove the new
placement-intent handling. No persisted ratio format changes are required.

## 1. Contract Tests

- [x] 1.1 Add `window_move` tests for cross-monitor move intent: portrait move-right records ultrawide leading-edge insertion, and ultrawide move-down records portrait trailing-edge insertion.
- [x] 1.2 Add ultrawide layout tests proving portrait-to-ultrawide transfer inserts the active window leftmost regardless of source x-coordinate or incoming target order.
- [x] 1.3 Add portrait layout tests proving ultrawide-to-portrait transfer inserts the active window bottommost regardless of source y-coordinate or incoming target order.
- [x] 1.4 Add layout tests proving same-layout drag/reposition can reorder by current geometry only after the target is established in the same layout scope.
- [x] 1.5 Add layout tests proving newly spawned portrait windows append after existing targets and do not reorder existing windows by initial geometry.
- [x] 1.6 Add layout tests proving swap and active resize messages no-op when no active target can be resolved.
- [x] 1.7 Add `order_state` or layout tests for missing and duplicate target identities falling back to source order without persistent order mutation.
- [x] 1.8 Add reload recovery tests proving empty order state initializes from current in-area geometry for ultrawide columns and portrait rows.

## 2. Shared State And Role Helpers

- [x] 2.1 Add a small monitor-role helper for current role mappings: `DP-2` as ultrawide and `HDMI-A-2` as portrait.
- [x] 2.2 Update `lib/window.lua`, `portrait_rows.lua`, and `ultrawide_master.lua` to use monitor roles instead of scattered connector-name checks where behavior depends on role.
- [x] 2.3 Extend `order_state.lua` with pending transfer intent storage keyed by stable target identity and destination monitor role.
- [x] 2.4 Add scoped position tracking keyed by layout name, workspace key, monitor role, axis, and target id.
- [x] 2.5 Add safe identity checks that detect missing or duplicate stable identities before persistent order state mutates.

## 3. Active Target Resolution

- [x] 3.1 Add shared active-target resolution that prefers `hl.get_active_window().address` when available.
- [x] 3.2 Make mutating layout paths use exactly one resolved active target and no-op when active resolution is ambiguous.
- [x] 3.3 Remove target-index-1 fallback from swap, active resize, and geometry reorder mutation paths while keeping placement fallback behavior for non-mutating recalculate paths.

## 4. Transfer Intent Implementation

- [x] 4.1 Update portrait-to-ultrawide move-right dispatch to record an ultrawide start-edge transfer intent before or alongside the monitor move.
- [x] 4.2 Update ultrawide-to-portrait move-down dispatch to record a portrait end-edge transfer intent before or alongside the monitor move.
- [x] 4.3 Consume pending transfer intent in `ultrawide_master.recalculate()` before geometry-based reorder and place the target at the requested edge.
- [x] 4.4 Consume pending transfer intent in `portrait_rows.recalculate()` before geometry-based reorder and place the target at the requested edge.
- [x] 4.5 Ensure consumed transfer intents are cleared after one matching destination placement.

## 5. Geometry And Reload Ordering

- [x] 5.1 Restrict geometry-based reorder to targets with matching layout scope and valid current centers inside the layout area.
- [x] 5.2 Suppress geometry-based reorder for targets that changed workspace, monitor role, or layout scope since their last remembered position.
- [x] 5.3 Initialize empty ultrawide workspace order from current x-center geometry when all targets are valid and in-area.
- [x] 5.4 Initialize empty portrait workspace order from current y-center geometry when all targets are valid and in-area.
- [x] 5.5 Fall back to source order without persistent geometry mutation when reload recovery geometry is incomplete, out-of-area, or mixed-role.

## 6. Cleanup And Validation

- [x] 6.1 Remove or rewrite tests that encode stale-source-geometry insertion behavior as desired behavior.
- [x] 6.2 Run `lua .config/hypr/tests/window_move.lua`.
- [x] 6.3 Run `lua .config/hypr/tests/ultrawide_master.lua`.
- [x] 6.4 Run `lua .config/hypr/tests/portrait_rows.lua`.
- [x] 6.5 Run `hyprctl configerrors`.
- [x] 6.6 Review the focused diff for unintended changes outside Hypr layout/keybind/order tests.

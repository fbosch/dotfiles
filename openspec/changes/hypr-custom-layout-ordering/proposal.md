## Why

The custom Hyprland layouts currently infer window-ordering intent from compositor snapshots that can be stale during monitor moves, workspace transfers, reloads, and focus changes. This produces unpredictable row/column placement even when the keybinding intent is clear.

## What Changes

- Define explicit ordering semantics for custom layout moves, swaps, transfers, and geometry-based reordering.
- Make user commands and transfer intent authoritative over stale source-monitor geometry.
- Restrict geometry-based reordering to confirmed same-layout repositioning and reload recovery.
- Make mutating layout operations fail closed when the active target or target identity is ambiguous.
- Scope remembered order and position state so portrait and ultrawide layouts do not interpret stale state from another monitor role or workspace.
- Keep ratio persistence behavior unchanged except where ordering semantics require separating order state from resize ratios.

## Capabilities

### New Capabilities
- `hypr-custom-layout-ordering`: Defines deterministic ordering behavior for custom Hyprland portrait rows and ultrawide master layouts.

### Modified Capabilities

## Impact

- Affected code: `.config/hypr/lib/window.lua`, `.config/hypr/layouts/shared/order_state.lua`, `.config/hypr/layouts/portrait_rows.lua`, `.config/hypr/layouts/ultrawide_master.lua`, and tests under `.config/hypr/tests/`.
- Affected runtime behavior: `SUPER+SHIFT+H/J/K/L` move/swap behavior, custom layout resize messages, cross-monitor transfer placement, and layout behavior after reload.
- No new dependencies are expected.

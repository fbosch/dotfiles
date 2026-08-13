## Why

Tiling a manually positioned floating window with `SUPER+V` currently lets
Hyprland's incoming target order decide where it appears. On the custom
layouts, that loses the spatial context the user created by positioning the
window before tiling it.

## What Changes

- Make `SUPER+V` preserve spatial intent when changing a floating window to a
  tiled window on the two custom layouts.
- Choose the destination slot from the floating window's pre-toggle center on
  the layout axis.
- Compare that coordinate with the center of every resulting slot and select
  the smallest distance; ties select the earlier slot.
- Keep ordinary float toggling unchanged when the active workspace does not
  use a local custom layout or reliable geometry is unavailable.

## Capabilities

### New Capabilities
- `hypr-custom-layout-float-to-tile-placement`: Coordinate-based slot placement
  when a floating window becomes tiled on a local custom layout.

### Modified Capabilities
- None.

## Impact

- `.config/hypr/keybinds.lua` and `lib/window/custom_layout.lua` will route
  the float-toggle bind through a layout-aware action.
- `layouts/shared/order_state.lua`, `layouts/shared/ordered_axis.lua`,
  `layouts/portrait_rows.lua`, and `layouts/ultrawide_master.lua` will carry
  and consume a one-shot placement request.
- Focused Lua tests will cover the bind action and slot selection for both
  layouts.

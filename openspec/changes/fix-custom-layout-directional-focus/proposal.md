## Why

Hyprland's native directional focus does not reliably cross between tiled and
floating windows on the local Lua custom layouts. From a tiled window it
strongly prefers tiled candidates; from a floating window it considers only
floating candidates. This makes `SUPER+H/J/K/L` inconsistent on portrait and
ultrawide workspaces.

## What Changes

- Define directional focus for `lua:portrait_rows` and
  `lua:ultrawide_master` as the nearest visible window in the requested
  direction, independent of tiled or floating state.
- Preserve native directional focus outside those custom layouts.
- Preserve the existing Picture-in-Picture focus override and its tiled-only
  candidate policy.
- Add focused regression coverage for mixed tiled/floating focus navigation.

## Capabilities

### New Capabilities

- `hypr-custom-layout-directional-focus`: Defines mixed tiled/floating
  directional focus behavior for the local custom Hyprland layouts.

### Modified Capabilities

- None.

## Impact

- Affected code: `.config/hypr/lib/window/directional.lua` and
  `.config/hypr/tests/window_move_spec.lua`.
- Affected behavior: `SUPER+H/J/K/L` on portrait and ultrawide custom-layout
  workspaces.
- The completed `hypr-custom-layout-ordering` change remains authoritative for
  placement, ordering, transfer, resize, and directional move semantics.
- Floating monitor-transfer behavior is specified separately in the ordering
  change, despite sharing `.config/hypr/lib/window/directional.lua`.
- No dependencies, persisted state, or configuration format changes are
  expected.

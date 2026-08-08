# Fix Custom Layout Directional Focus

## Problem

`SUPER+H/J/K/L` delegates ordinary directional focus to Hyprland in
`.config/hypr/lib/window/directional.lua`. On the Lua custom layouts,
Hyprland's direction query does not reliably cross between tiled and floating
windows:

- A tiled source prefers tiled candidates and only considers floating windows
  under strict adjacency rules.
- A floating source considers floating candidates, not tiled windows.

The desired policy on `lua:portrait_rows` and `lua:ultrawide_master` is to
focus the nearest visible window in the requested direction, regardless of
whether either window floats.

## Scope

- Change only `.config/hypr/lib/window/directional.lua` and its focused tests.
- Apply the new policy only to the two local custom layouts.
- Preserve native directional focus outside the custom layouts.
- Preserve the existing PiP override and its tiled-only candidate policy.

## Implementation

1. Add a private directional-candidate resolver in
   `.config/hypr/lib/window/directional.lua`.
   - Obtain candidates from `active.workspace:get_windows()`.
   - Return no candidate when the active window, workspace accessor, or source
     geometry is unavailable.
   - Ignore the active window, invisible windows, and windows without complete
     `at` and `size` geometry.
   - Include both tiled and floating candidates.
   - Compare window centres, accepting only candidates strictly left, right,
     above, or below the active window for the requested direction.
   - Select the candidate with the smallest squared centre distance.

2. Route `M.focus` through that resolver only when
   `state.uses_any_custom_layout(active)` returns true.
   - Dispatch `hl.dsp.focus({ window = candidate })` when a candidate exists.
   - Otherwise retain `hl.dsp.focus({ direction = normalized })` as the
     fallback, including at a layout edge.
   - Keep the existing delayed cursor warp after either dispatch.
   - Keep `with_window_behavior` unchanged so PiP handling runs first.

3. Extend `.config/hypr/tests/window_move_spec.lua` with focus regression
   coverage.
   - A tiled source focuses a floating target on `lua:ultrawide_master`.
   - A floating source focuses a tiled target on `lua:portrait_rows`.
   - The geometrically nearest mixed-state candidate wins.
   - Opposite-direction, invisible, and malformed candidates are ignored.
   - No local candidate falls back to native directional focus.
   - A non-custom layout remains on native directional focus even with a
     nearby floating window.
   - PiP keeps precedence and continues to select only non-floating targets.

## Validation

1. Run the focused suite:

   ```bash
   devenv shell -- busted --lua=luajit .config/hypr/tests/window_move_spec.lua
   ```

2. Run the repository Lua checks:

   ```bash
   devenv test test:lua
   devenv test test:lua-quality
   ```

3. Reload the compositor configuration and check it parses:

   ```bash
   hyprctl reload
   hyprctl configerrors
   ```

4. Live-test both `lua:portrait_rows` and `lua:ultrawide_master`:
   - Focus from a tiled window to a floating window in each applicable
     direction.
   - Focus from a floating window to a tiled window in each applicable
     direction.
   - Confirm no eligible local candidate still permits the existing native
     edge behavior.
   - Confirm a PiP window still focuses a tiled window rather than a nearby
     floating window.

## Success Criteria

- Directional focus moves between tiled and floating windows on both custom
  layouts according to nearest visible directional geometry.
- Existing PiP semantics and non-custom-layout focus behavior remain intact.
- Focused Lua tests and compositor configuration validation pass.

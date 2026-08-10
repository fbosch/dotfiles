## 1. Focus Selection Tests

- [x] 1.1 Add `window_move_spec` coverage for tiled-to-floating focus on the
  ultrawide custom layout and floating-to-tiled focus on the portrait custom
  layout.
- [x] 1.2 Add focus-selection tests proving nearest mixed-state candidates win
  and opposite-side, invisible, and incomplete candidates are ignored.
- [x] 1.3 Add regression tests proving no local candidate retains native
  directional fallback, non-custom workspaces retain native focus, and PiP
  retains its tiled-only override.

## 2. Custom Layout Focus Routing

- [x] 2.1 Add a private workspace-local directional candidate resolver that
  selects the nearest visible tiled or floating candidate by geometry.
- [x] 2.2 Route ordinary directional focus through the resolver only for the
  recognised portrait and ultrawide custom layouts.
- [x] 2.3 Retain existing native fallback and delayed cursor warp behavior when
  the resolver has no eligible candidate.

## 3. Validation

- [x] 3.1 Run the focused `window_move_spec` suite with LuaJIT.
- [x] 3.2 Run `busted --lua=luajit .config/hypr/tests` and
  `REQUIRE_LUA_TOOLS=1 bash scripts/lua-quality.sh ci`.
- [x] 3.3 Reload Hyprland and run `hyprctl configerrors`.
- [ ] 3.4 Live-test tiled-to-floating and floating-to-tiled directional focus
  on both custom layouts, including PiP precedence.

## 4. Cross-Monitor Focus

- [x] 4.1 Add focus-selection tests for portrait-right to ultrawide and
  ultrawide-left to portrait transitions.
- [x] 4.2 Focus the nearest eligible window on the paired monitor after local
  custom-layout candidates are exhausted.
- [x] 4.3 Live-test paired-monitor directional focus transitions.

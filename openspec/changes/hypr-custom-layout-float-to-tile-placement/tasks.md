## 1. Contract Tests

- [x] 1.1 Add bind-action tests that capture a floating window's center only
  for float-to-tile transitions on the two local custom layouts.
- [x] 1.2 Add ultrawide layout tests for nearest left, center, and right slot
  selection using resulting unequal column ratios.
- [x] 1.3 Add portrait layout tests for nearest top, middle, and bottom slot
  selection using resulting unequal row ratios.
- [x] 1.4 Add layout tests proving equidistant slot centers choose the earlier
  slot and existing tiled targets retain relative order.
- [x] 1.5 Add tests for incomplete geometry, missing identity, non-custom
  layouts, tiled-to-floating transitions, one-shot consumption, and expiration.

## 2. Placement Intent

- [x] 2.1 Add a bounded, one-shot float-to-tile placement intent to shared
  ordering state, keyed by stable window identity and custom-layout context.
- [x] 2.2 Add shared axis helpers that calculate resulting slot centers and
  choose the earliest minimum-distance insertion index.
- [x] 2.3 Consume a matching placement intent before ordinary new-target
  insertion and geometry-based reordering in both custom layouts.
- [x] 2.4 Clear placement requests after successful consumption or bounded
  expiration without affecting transfer intent behavior.

## 3. Float Toggle Integration

- [x] 3.1 Add a layout-aware float-toggle action that records the active
  floating window's pre-toggle axis center when safe.
- [x] 3.2 Route `SUPER+V` through the new action while retaining the existing
  passthrough-exempt predicate.
- [x] 3.3 Preserve the direct Hyprland float-toggle dispatcher as the fallback
  for every out-of-scope or incomplete-state transition.

## 4. Validation

- [x] 4.1 Run the focused `window_move`, `portrait_rows`, and
  `ultrawide_master` Busted suites through LuaJIT.
- [x] 4.2 Run the repository `test:lua` and `test:lua-quality:hyprland` tasks.
- [x] 4.3 Reload the Hyprland configuration when safe and run
  `hyprctl configerrors`.
- [x] 4.4 Live-test float-to-tile placement on both layouts with unequal ratios,
  and validate the subpixel exact-center-distance tie deterministically.

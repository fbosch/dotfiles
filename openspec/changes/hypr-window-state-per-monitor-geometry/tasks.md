## 1. Characterize And Extend Coverage

- [x] 1.1 Extend `window_state_rules_spec.lua` to characterize the current rule cache and generated rule output, including monitor-relative geometry, last-observation replacement, literal and regex selector rendering, and unchanged-write behavior.
- [x] 1.2 Add focused rule-cache tests for independent selector-monitor entries, same-monitor replacement, per-monitor selector pruning, and legacy `effects.monitor` loading.
- [x] 1.3 Extend the window-state runtime fixture with two monitor definitions and verify the daemon preserves distinct geometry for one selector on both monitors through generated rule output.

## 2. Implement Per-Monitor Persistence

- [x] 2.1 Change window-state cache identity, loading, updating, and pruning to operate on selector-monitor pairs.
- [x] 2.2 Render monitor metadata and `workspace = "m[<monitor>]"` matchers for monitor-specific entries, while omitting the `monitor` rule effect.
- [x] 2.3 Load legacy generated rules that use `effects.monitor` and rewrite them in the monitor-scoped format without losing their saved geometry.
- [x] 2.4 Keep generated-rule ordering deterministic and preserve atomic rule-file publication and conditional rule-phase refresh.

## 3. Validate

- [x] 3.1 Run the focused window-state rules and runtime tests.
- [ ] 3.2 Run `devenv test` for the repository test suite, including Lua-quality checks.
- [x] 3.3 Reload Hyprland and run `hyprctl configerrors`.
- [ ] 3.4 Live-test one selector with distinct geometry on each monitor, then confirm opening it from each monitor's active workspace restores that monitor's saved geometry without relocating the window.

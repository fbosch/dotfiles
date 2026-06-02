# Hyprland Quality Refactor Plan

This plan targets the high-severity structural findings from the current-state code quality review. The goal is to preserve behavior while reducing confusing ownership, duplicated state logic, and adapter layers that make future changes harder to verify.

## Window Capture Daemon Boundary

Problem: `.config/hypr/runtime/windows/daemons/window-capture/window-capture-daemon.sh` enters daemon mode by `exec`ing the Lua wrapper, and the Lua wrapper shells back into the same shell script for every event. The shell script also contains an event loop that daemon mode no longer reaches.

Target shape: one daemon owner. Either the shell script handles the event socket directly, or the Lua daemon owns event handling and capture orchestration without calling back into the shell script per event.

- [x] Record current behavior: daemon startup, `refresh-once`, `handle-event`, active-window capture, workspace capture, overlay suppression, stale cleanup, and lock handling.
- [x] Decide the owner: Lua owns daemon mode, event filtering, debounce, cleanup, capture decisions, and `refresh-once`/`handle-event`.
- [x] Skip the shell-only path because Hyprland runtime helpers should prefer Lua when practical.
- [x] Move event classification, debounce, lock handling, cleanup, and capture decisions into Lua, leaving shell only as an exec shim.
- [x] Delete the unreachable or redundant event loop after choosing the owner.
- [x] Keep `refresh-once` and `handle-event` as explicit CLI modes for manual refresh and narrow testing.
- [x] Validate with `bash -n .config/hypr/runtime/windows/daemons/window-capture/window-capture-daemon.sh`.
- [x] Validate with `lua -e 'assert(loadfile(".config/hypr/runtime/windows/daemons/window-capture/window-capture-daemon.lua"))'`.
- [x] Validate daemon startup does not spawn a shell process per Hyprland event.
- [x] Benchmark daemon hot path against the old implementation; matching events are faster in the controlled harness.
- [x] Validate screenshots still refresh for active-window, workspace, open-window, move-window, fullscreen, and close-window events.

## Window State Daemon Decomposition

Problem: `.config/hypr/runtime/windows/daemons/window-state/window-state-daemon.lua` owns selector parsing, jq extraction, cache loading, Lua rule generation, live rule application, debounce, adaptive polling, and socket orchestration in one file. It also parses `rule.comment` as identity, which turns comments into data contracts.

Target shape: the daemon only handles events and scheduling. A pure rule-state module owns selectors, cache entries, generated rule data, and file writes.

- [ ] Capture the current inputs and outputs: selectors file, generated rules file, runtime cache file, debounce file, Hypr IPC clients, Hypr IPC monitors, and `hyprctl eval` refresh.
- [ ] Extract matcher mapping into one table that covers Hypr client fields and Lua rule match keys.
- [ ] Extract a pure `window-state/rules.lua` module that converts selector plus window geometry into `{ id, matcher, pattern, match, effects }` entries.
- [ ] Stop parsing identity from `comment`; load identity from `id`, `matcher`, and `pattern` fields instead.
- [ ] Keep comments as display-only metadata, or remove them from generated output if they duplicate `id`.
- [ ] Extract generated-file writing into a small writer function that accepts normalized rule entries and returns whether content changed.
- [ ] Keep debounce, polling, and socket reconnect logic in the daemon file after the rule-state logic moves out.
- [ ] Add a CLI guard so unknown args fail and `--help` prints usage instead of starting the daemon.
- [ ] Validate Lua parsing for the daemon and extracted modules with `lua -e 'assert(loadfile(...))'`.
- [ ] Validate a forced state update rewrites `rules/window-state.lua` only when content changes.
- [ ] Validate `hyprctl eval` refresh still applies the window-state phase without a full reload.

## Generated Rule Contract

Problem: generated rules and static rules use different shapes. Generated rules return `{ id, match, effects, source, comment }`; static rules call `hl.window_rule` directly with Hypr-native fields. `rule-loader.lua` exists mostly to unwrap `effects` and special-case `size` and `move` pairs.

Target shape: one clear generated-rule contract. Either generated files emit Hypr-native rule tables directly, or `rule-loader.lua` becomes the documented canonical boundary for all generated data and no longer carries incidental compatibility behavior.

- [ ] Re-read `.config/hypr/docs/lua-migration-plan.md` before changing this, because it currently documents generated Lua data tables plus a central loader as the migration decision.
- [ ] Decide whether the current loader decision still pays for itself now that Lua config is live.
- [ ] If using Hypr-native generated rules, update quickrule and window-state writers to emit `{ name?, match, float, size, move, ... }` directly.
- [ ] If keeping the loader, make the generated schema explicit in code and docs: required fields, optional fields, identity fields, and Hypr effect normalization.
- [ ] Remove `comment` from any loader or cache identity path.
- [ ] Move `size` and `move` normalization to the writers if the generated files stay as data, so the loader does not need pair-specific knowledge.
- [ ] Keep rule phase order unchanged: generated rules, static window rules, window-state rules, then static layer rules.
- [ ] Validate `rules/generated.lua` and `rules/window-state.lua` still return tables.
- [ ] Validate `rule-loader.apply_window_rule_phase(config_dir, "generated")` and `rule-loader.apply_window_rule_phase(config_dir, "window_state")` still apply the expected number of rules.
- [ ] Update `.config/hypr/docs/lua-migration-plan.md` if the generated-rule contract changes.

## Minimized Window State Ownership

Problem: minimized-window state is spread across `toggle-minimized-window.sh`, `toggle-minimized-workspace.sh`, `toggle-show-desktop.sh`, and `minimized-state-daemon.lua`. These paths duplicate bucket logic, special-workspace logic, Lua dispatch construction, state-file initialization, and JSON mutation. Related state updates are not guarded by a shared lock.

Target shape: one minimized-state owner. Scripts should call a small command API or shared locked library instead of each mutating the same JSON state differently.

- [ ] Map all state transitions: minimize active window, restore active minimized window, toggle minimized workspace, toggle target minimized workspace, show desktop, restore desktop, prune closed windows.
- [ ] Define the state model once: address, source workspace, monitor, bucket, special workspace, floating flag, position, and size.
- [ ] Add one lock path for all writes to `hypr-minimized-state.json`.
- [ ] Create a shared state module or script API that owns `init`, `save`, `restore`, `delete`, `prune`, `bucket-for`, and `special-workspace-for`.
- [ ] Move duplicated Lua dispatch string construction into one helper, or expose higher-level commands such as `move-window`, `focus-window`, `resize-window`, and `toggle-special`.
- [ ] Update `toggle-minimized-window.sh` to call the shared owner instead of writing JSON directly.
- [ ] Update `toggle-minimized-workspace.sh` to call the shared owner for bucket lookup and target special-workspace resolution.
- [ ] Decide whether `toggle-show-desktop.sh` should use the same minimized-state model or remain separate; do not keep duplicated window geometry restore logic in both places without a reason.
- [ ] Keep `minimized-state-daemon.lua` focused on close-window pruning, or fold pruning into the shared owner if the daemon becomes unnecessary.
- [ ] Validate Bash syntax for all changed minimized/show-desktop scripts.
- [ ] Validate concurrent minimize/restore calls cannot corrupt the JSON state file.
- [ ] Validate floating windows restore workspace, monitor, size, and position.

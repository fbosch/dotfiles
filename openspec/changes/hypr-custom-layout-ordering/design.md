## Context

The Hyprland config has two custom Lua layouts:

- `portrait_rows` places windows in vertical rows on the portrait monitor.
- `ultrawide_master` places windows in horizontal columns on the ultrawide monitor.

The current ordering model combines explicit commands, inferred geometry, remembered positions, active-window tracking, and Hyprland-provided target order. That works for simple same-layout swaps, but it becomes unstable around cross-monitor moves because Hyprland snapshots can contain source-monitor geometry, stale monitor metadata, or incomplete active-window state.

The current tests pass, but some tests now preserve behavior that conflicts with the desired user-facing contract. The change should define the contract first, then make the code match it.

## Goals / Non-Goals

**Goals:**

- Make cross-monitor move placement deterministic.
- Make same-layout swaps explicit and independent of stale geometry.
- Keep geometry-based reordering for confirmed same-layout drag/reposition behavior.
- Recover order after reload from current visible geometry when it is safe.
- Fail closed when active target or target identity is ambiguous.
- Keep the implementation local to the Hyprland Lua config and tests.

**Non-Goals:**

- Rewriting resize-ratio persistence.
- Adding new runtime dependencies.
- Supporting arbitrary monitor topologies in this change.
- Replacing the custom layouts with a built-in Hyprland layout.

## Decisions

### Explicit transfer intent wins over geometry

Cross-monitor moves should record an insertion intent before the destination layout reconciles target order.

The intent model should be small:

- target id
- destination monitor role
- axis
- edge
- optional destination workspace key when available

For the current monitor roles:

- portrait to ultrawide via move-right records `axis = "x"`, `edge = "start"`.
- ultrawide to portrait via move-down records `axis = "y"`, `edge = "start"`.

Alternative considered: infer destination slot from stale `window.at`. That is the current source of weird behavior and should not remain the primary signal for transfers.

### Geometry reordering is a same-layout operation

Geometry should still support drag-like behavior, but only when the target is already established in the same layout scope.

The layout scope should include:

- layout name
- workspace key
- monitor role
- axis

If a target enters a different scope, the first destination placement establishes local position state. Source-scope positions must not decide destination order.

Alternative considered: keep global `position_by_id` and add more guards. That keeps the same failure mode: every transition needs another exception.

### Active target resolution must fail closed

Mutating operations should not default to target index `1`. A missing active marker is safer as a no-op than a wrong-window swap or resize.

Resolution order:

- Prefer a target whose `window.address` matches `hl.get_active_window().address` when available.
- Otherwise use exactly one target with `window.active == true`.
- If neither is available, do not mutate order or ratios.

Alternative considered: preserve target-1 fallback for compatibility. That fallback makes transient focus snapshots mutate the wrong target.

### Stable identity gates persistent order mutation

Persistent order state should only mutate when target identities are stable and unique. `window.address` is the preferred identity. Fallback identities can still be used for one-frame placement, but they should not update durable ordering, seen-target state, or remembered positions.

Alternative considered: keep `stable_id` and `target.index` as equivalent fallbacks. Those values are useful for tests and placement, but they are not strong enough to carry cross-recalc intent safely.

### Reload recovery derives initial order from visible geometry

Order state is currently in-memory only, while ratio state persists. Persisting order is not necessary for this change if reload can initialize from confirmed current positions.

On first recalc for a workspace after module load:

- If all targets have valid centers inside the destination layout area, initialize order by axis position.
- Otherwise initialize from source order and wait for a confirmed placement.

Alternative considered: persist order to disk. That adds migration and stale-window cleanup problems and is not required to solve the immediate weirdness.

### Monitor roles should be centralized

The code should stop scattering `DP-2` and `HDMI-A-2` checks across keybinds and layouts. A small monitor-role helper can keep the current mappings while giving the layout and keybind code the same vocabulary.

Initial mappings can remain:

- `DP-2` -> `ultrawide`
- `HDMI-A-2` -> `portrait`

Alternative considered: infer roles from aspect ratio or monitor description immediately. That is useful later, but it broadens this change beyond the ordering problem.

## Risks / Trade-offs

- Transfer intent could be recorded before a stable target id is available -> If the id is missing, skip intent and use source order rather than guessing.
- Destination workspace may not be known at dispatch time -> Key intent by target id and monitor role first; consume it only when the target appears in the matching destination role.
- Geometry recovery after reload can preserve a bad transient snapshot -> Require all target centers to be inside the destination layout area before sorting by geometry.
- Failing closed may make a keypress appear to do nothing during a transient focus snapshot -> This is preferable to moving or resizing the wrong window.
- Centralizing monitor roles adds a new small module -> The tradeoff is worth it because it removes divergent monitor checks between keybind and layout code.

## Migration Plan

1. Add tests for the new ordering contract before changing behavior.
2. Introduce monitor-role and transfer-intent helpers behind the existing layout modules.
3. Update `lib/window.lua` cross-monitor move branches to record transfer intent.
4. Update `portrait_rows` and `ultrawide_master` to consume transfer intent before geometry reorder.
5. Restrict geometry reorder to same-layout scope.
6. Replace target-1 active fallback for mutating paths with fail-closed active resolution.
7. Add reload recovery from confirmed current geometry.
8. Run focused Lua tests and `hyprctl configerrors`.

Rollback is local: revert the changed Lua layout/keybind files and tests. No data migration is required because this change does not alter persisted ratio files.

## Open Questions

- Should future monitor-role mapping use connector names only, or also match monitor description/model for hotplug stability?
- Should transfer intent eventually support middle/anchor insertion, or are explicit leading/trailing edges enough for the current monitor topology?

## Context

See `proposal.md` for the motivation and
`specs/hypr-custom-layout-directional-focus/spec.md` for the behavioral
contract. The local layouts own placement and ordering, while directional focus
currently delegates to Hyprland. Hyprland's native candidate selection has
different tiled and floating paths, so it cannot provide the required mixed
navigation policy consistently.

The completed `hypr-custom-layout-ordering` change remains authoritative for
layout ordering, transfer intent, resize messages, and monitor roles. This
change must not alter any of those paths.

## Goals / Non-Goals

**Goals:**

- Resolve a visible, geometrically valid mixed tiled/floating focus target on
  the two local custom layouts.
- Preserve native behavior when the custom policy cannot select a target.
- Keep the PiP override before ordinary custom-layout focus handling.

**Non-Goals:**

- Changing window placement, ordering, transfer intent, resizing, or persisted
  ratio state.
- Replacing native directional focus on non-custom layouts.
- Redefining PiP candidate selection.
- Supporting arbitrary custom layouts beyond `portrait_rows` and
  `ultrawide_master`.

## Decisions

### Use workspace-local geometry with paired-monitor edge traversal

The resolver will inspect windows belonging to the active window's workspace.
It will compare the centres of windows with usable geometry, retain only those
strictly in the requested half-plane, and select the smallest squared distance.

This keeps candidate scope local to the visible layout workspace and produces a
single policy for tiled-to-floating and floating-to-tiled navigation. When no
local candidate exists, portrait-right selects from the ultrawide monitor and
ultrawide-left selects from the portrait monitor using the same geometry rule.
Other edges retain native focus behavior.

Alternative considered: change Hyprland focus preferences. Native focus has
separate tiled and floating selection modes and strict adjacency behavior, so a
configuration preference cannot express the required mixed nearest-window
policy or the monitor-pair edge policy.

### Limit the resolver to recognised custom layouts

The ordinary focus path will invoke local candidate selection only when the
active window is on `lua:portrait_rows` or `lua:ultrawide_master`, using the
existing custom-layout detection. Otherwise it will continue to dispatch native
directional focus unchanged.

Alternative considered: apply the resolver globally. That would replace
Hyprland's established focus behavior across unrelated layouts and monitors.

### Preserve override and fallback order

PiP behavior remains the first focus handler. If it declines to handle focus,
the ordinary path will use the custom-layout resolver where applicable. When no
eligible candidate is found, the existing native directional dispatch remains
the fallback, followed by the existing cursor warp.

Alternative considered: use the mixed resolver after PiP declines in all cases.
That would unintentionally change PiP's intentional tiled-only policy.

## Risks / Trade-offs

- Candidate geometry can be temporarily unavailable during lifecycle changes
  → Ignore incomplete candidates and retain native directional focus.
- Centre distance can select a diagonally offset candidate rather than one with
  the largest perpendicular overlap → This is the explicitly chosen nearest
  directional policy and is simpler than duplicating Hyprland adjacency rules.
- PiP handling could regress through fallback ordering → Add a focused test
  proving PiP still ignores floating candidates.
- The behavior depends on Hyprland window snapshots → Keep the resolver small,
  workspace-local, and covered by dispatch-level tests plus live validation.

## Migration Plan

1. Add regression tests for the specified focus-selection cases.
2. Add the custom-layout-only resolver and route ordinary focus through it.
3. Run focused and repository Lua validation.
4. Reload Hyprland, check configuration errors, and live-test both custom
   layouts with mixed tiled/floating windows.

Rollback is local: revert the directional-focus helper and focused tests. No
state migration is needed because the change neither reads nor writes persisted
layout state.

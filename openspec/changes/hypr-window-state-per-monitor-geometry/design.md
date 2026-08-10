## Context

The baseline `hypr-window-state-persistence` capability stores a single cache
entry per selector. Each generated rule places a matching window on the last
saved monitor, which prevents separate locations on multiple monitors. See
`proposal.md` for the motivation and the delta spec for required behavior.

## Goals / Non-Goals

**Goals:**

- Keep a separate position and size for the same selector on each monitor.
- Restore state based on the monitor of the workspace where a window opens.
- Retain existing generated state during the one-time representation change.
- Keep the daemon's event-driven update and debounce behavior intact.

**Non-Goals:**

- Track multiple same-selector windows independently on one monitor.
- Add monitor tags or change the shared window-tag registry.
- Persist tiled, fullscreen, pinned, or unmatched windows.
- Generalize monitor roles or connector names beyond the monitor names Hyprland
  reports at runtime.

## Decisions

### Key state by selector and monitor

Persisted cache identity will include matcher, pattern, and monitor name. This
allows a later capture on `DP-2` to replace only `DP-2` geometry while retaining
the same selector's `HDMI-A-2` geometry.

The alternative, storing a table of monitor locations inside one selector
entry, would also work but would require a broader cache and rendering
refactor. One entry per selector-monitor pair fits the existing sorted cache
and generated-rule pipeline.

### Match the monitor through the window workspace

Generated rules will combine the existing selector match with Hyprland's
workspace monitor selector, `m[<monitor>]`. The rule will retain monitor-local
`move` and `size` effects but remove the static `monitor` effect.

Hyprland evaluates `move` and `size` when the window opens, so a dynamic tag
assigned later by the daemon cannot select geometry reliably. Workspace monitor
matching is available at rule evaluation time and requires no tag lifecycle.

### Retain monitor metadata outside generated rule effects

Generated rule data will carry the monitor name as window-state metadata rather
than as a Hyprland effect. The cache loader will read the new metadata, while
also accepting a legacy `effects.monitor` value. The rule loader already
compiles only fields under `effects` into Hyprland rules, so metadata does not
alter compositor behavior.

### Migrate on the next write

The daemon will load legacy generated entries into monitor-scoped cache entries
and rewrite them in the new representation when it next writes the rules file.
This preserves the current recorded locations without adding a second
persistent store or a long-lived compatibility format.

## Risks / Trade-offs

- [Workspace monitor selector matches existing workspaces] → Validate with the
  two-monitor runtime fixture and live-test opening the selector from each
  monitor's active workspace.
- [A monitor name cannot be resolved from a client] → Do not generate a
  monitor-scoped rule for that capture; retain existing valid persisted entries.
- [Existing generated state could be lost during conversion] → Add a focused
  legacy load-and-rewrite test before changing the renderer.
- [Multiple matching windows on one monitor still share state] → Preserve the
  current last-observation-wins behavior; distinct-instance persistence remains
  out of scope.

## Migration Plan

1. Extend rule-cache loading to interpret legacy `effects.monitor` as saved
   monitor metadata.
2. Generate and load monitor metadata with each new rule, and render workspace
   monitor matching without `effects.monitor`.
3. On the next stable observation or selector reload, atomically rewrite the
   generated rules file in the new format and refresh the window-state phase.
4. Roll back by restoring the previous generated rules file and daemon code;
   the prior loader continues to understand rules with `effects.monitor`.

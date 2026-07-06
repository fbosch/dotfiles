# Revalidate Targeted Keyboard By Client Identity

**Status:** accepted
**Date:** 2026-07-06

## Context

Guarded keyboard originally rejected unless the approved target was still the active Hyprland window immediately before dispatch. Hyprland 0.55 documents `send_shortcut({ mods, key, window? })` and `send_key_state({ mods, key, state, window? })`, and `hyprctl dispatch` can pass an explicit `window` selector to those dispatchers.

## Decision

Revalidate that the approved target still exists in current Hyprland clients and still matches its approved identity, then dispatch to that explicit selector. The approved target no longer needs to be focused or active. The selector still prefers `stableid:<stableId>` and falls back to `address:0x<address>` only when stable ID is unavailable.

## Alternatives Considered

Keeping active-window revalidation was rejected because it caused false rejections when focus-follow-mouse or adjacent windows changed active focus while the approved target still existed. Broad selectors such as class or title were rejected for input dispatch because they can match the wrong window. Generic focused input tools remain out of scope.

## Consequences

Guarded keyboard can now use Hyprland's targeted dispatcher as intended for non-focused approved windows. The implementation keeps fail-closed handling for missing targets, identity drift, unmapped clients, and different active/target XWayland windows because Hyprland's targeted input path has known XWayland caveats.

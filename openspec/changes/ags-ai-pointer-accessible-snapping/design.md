## Context

AT-SPI is available through GObject Introspection after the configured NixOS rebuild and graphical-session restart. Its object APIs are synchronous D-Bus calls. GTK4 Wayland providers cannot report compositor-global screen origins reliably, while Hyprland owns the required window origin.

## Decisions

### Isolate AT-SPI from the AGS GTK process

A short-lived GJS helper imports `Atspi-2.0`, applies a short per-call timeout, inspects only the matching process, and emits bounded versioned JSON. AGS launches it asynchronously using its own GJS executable, incrementally caps stdout, and enforces an outer timeout with `Gio.Cancellable` and process termination. This prevents an unresponsive provider from blocking the shell UI. Exact protocol and coordinate-space fields make independently deployed helper/controller versions fail safely.

### Reconcile window-local and compositor-global coordinates

The controller first validates the active Hyprland client's identity, PID, origin, size, and relationship to the stroke rectangle. The helper uses `Atspi.CoordType.WINDOW` and prefers one uniquely active or focused dimension-compatible top-level under the matching process. Flatpak and other accessibility proxies can own the AT-SPI connection under a different PID, so an exact-PID miss falls back only when one active/focused dimension-compatible top-level exists across all registered applications. The helper returns window-local candidates wholly inside that window. AGS revalidates the active client after lookup, adds the compositor-owned global origin, and requires final padded bounds to remain inside the client.

### Snap only above a conservative confidence boundary

Pure policy requires an allowlisted semantic role, strong candidate coverage, compatible area, center agreement, and a clear score margin over geometrically distinct alternatives. Candidate bounds receive small capture padding and pass the existing pixel, integer, and active-client containment validation. Generic containers, sensitive ancestry, and every unavailable, invalid, ambiguous, stale, or timed-out path fall back to the original stroke rectangle.

### Keep accessibility metadata local

The helper reads only role, bounded name, state, process ID, parent relationships, and component bounds. It never calls Text, EditableText, Value, or description APIs. The controller keeps copied metadata separate from `Capture`, so future request code cannot accidentally inherit it from the image contract.

## Risks / Trade-offs

- [Application trees are absent or incomplete] -> Preserve stroke geometry without treating lookup failure as capture failure.
- [Wayland coordinates disagree] -> Use window coordinates plus a freshly revalidated Hyprland origin and reject identity, focus, size, or containment mismatches.
- [A provider hangs] -> Use per-call limits and a parent-enforced helper timeout.
- [Nested controls are geometrically similar] -> Require a score margin; ambiguity falls back to the stroke.
- [Accessible names contain sensitive context] -> Reject password ancestry, bound and display eligible names locally only, and never query text/value APIs or log helper output.
- [Helper and controller deploy independently] -> Require exact protocol and coordinate-space fields; mismatches preserve stroke geometry.

## Migration Plan

1. Rebuild the staged NixOS AT-SPI/typelib configuration and start a fresh graphical session.
2. Deploy the helper, policy, and controller integration; inaccessible applications continue using stroke bounds.
3. Roll back by removing the resolver integration; the existing stroke capture contract remains valid.

## Context

AT-SPI is available through GObject Introspection after the configured NixOS rebuild and graphical-session restart. Its object APIs are synchronous D-Bus calls. GTK4 Wayland providers cannot report compositor-global screen origins reliably, while Hyprland owns the required window origin.

## Decisions

### Isolate AT-SPI from the AGS GTK process

A short-lived TypeScript GJS helper imports `Atspi-2.0`, applies a short per-call timeout, inspects only the matching process, and emits bounded versioned JSON. AGS bundles the feature-local helper atomically into `XDG_RUNTIME_DIR` during startup, launches it asynchronously, incrementally caps stdout, and enforces an outer timeout with `Gio.Cancellable` and process termination. This prevents an unresponsive provider from blocking the shell UI without committing generated JavaScript. Exact protocol and coordinate-space fields make independently deployed helper/controller versions fail safely.

### Reconcile window-local and compositor-global coordinates

The controller first validates the active Hyprland client's identity, PID, origin, size, and relationship to the stroke rectangle. The helper uses `Atspi.CoordType.WINDOW` and prefers one uniquely active or focused dimension-compatible top-level under the matching process. Flatpak and other accessibility proxies can own the AT-SPI connection under a different PID, so an exact-PID miss falls back only when one active/focused dimension-compatible top-level exists across all registered applications. The helper returns window-local candidates wholly inside that window. AGS revalidates the active client after lookup, adds the compositor-owned global origin, and requires final padded bounds to remain inside the client. Program identity is resolved independently from Hyprland geometry: the active client wins when it contains the selection center, otherwise mapped visible clients containing that point are ordered by focus history. This allows non-AT-SPI applications such as terminals to retain bounded class, title, PID, and geometry metadata without manufacturing an accessible element.

### Rank bounded brush-aware candidates fuzzily

The helper samples the center first, then the remaining points in a bounded 3×3 interior grid. It also selects five centerline anchors by path distance and probes the center and both normal offsets at the shared brush radius. Deduplication bounds this to at most 24 hit points, and the versioned request caps raw stroke input independently. The helper records both center membership and total hit count for each candidate. A center-hit link is authoritative over a nested image; otherwise a center-hit image selects the complete image. Explicit nearby direct hits may use the shared brush-radius tolerance but remain behind actual center hits. Pure policy combines exact and padded overlap, center affinity, relative size, and repeated hits. Repeated hit paths let a bounded common ancestor outrank separate children. When no clear common ancestor exists, two to eight strong, non-overlapping semantic candidates whose centers lie inside the selection may form a collection. The collection rejects overlapping alternatives, requires its member area to occupy at least 15% of the union bounds, and limits the union to five times the drawn selection area. A partial selection may otherwise expand to one target no more than five times its area. A named section or article reached by at least seven points may expand up to twelve times the selection area, covering controls such as media players whose accessibility tree exposes only the larger semantic container. Candidate or collection-union bounds receive small capture padding and pass the existing pixel, integer, and active-client containment validation. Unnamed oversized containers, sensitive ancestry, sparse collections, and every unavailable, invalid, ambiguous, stale, or timed-out path fall back to the original stroke rectangle.

### Keep accessibility metadata local

The helper reads only role, bounded name, state, process ID, parent relationships, component bounds, and the first valid Hyperlink URI for link-role candidates. It never calls Text, EditableText, Value, or description APIs. Link URIs are optional, limited to 512 characters, and restricted to whitespace-free HTTP or HTTPS values before crossing the versioned helper boundary. For local targeting diagnostics, the controller presents coordinate-matched Hyprland class, title, PID, and geometry independently from optional candidate role, name, URL, bounds, center-hit flag, hit count, and confidence. The preview renders this evidence beside the image. The controller keeps copied metadata separate from `Capture`, so future request code cannot accidentally inherit it from the image contract.

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

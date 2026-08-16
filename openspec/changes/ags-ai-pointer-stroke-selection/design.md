## Context

See `proposal.md` for motivation and the capability spec for behavior. The existing AI Pointer records only press and release coordinates from Hyprland and derives an endpoint rectangle. AGS already owns capture, private storage, preview, cancellation, and lifecycle state.

Wayland does not provide a global pointer-motion stream to a layer surface mapped after the activating button press. The Hyprland event socket also does not publish cursor-motion events. A reliable AGS-only implementation therefore needs bounded, activation-scoped cursor sampling while the gesture is held.

## Goals / Non-Goals

**Goals:**

- Keep drawing, capture, preview, and cleanup inside the existing AI Pointer feature slice.
- Preserve global coordinates across negative monitor origins and monitor boundaries.
- Bound sampling work and retained stroke history independently.
- Keep the visual overlay click-through so it cannot become a desktop interaction surface.

**Non-Goals:**

- Accessibility lookup, OCR, semantic target snapping, polygon clipping, or freehand image masks.
- Persisting or transmitting raw stroke coordinates.
- Running a long-lived cursor polling daemon.

## Decisions

### Sample the compositor cursor only during an active gesture

The controller starts one GTK frame-clock callback on the overlay surface containing the activation point and removes it before capture, cancellation, or teardown. Each tick reads `j/cursorpos` through the existing direct Hyprland IPC helper. The press and release callbacks remain authoritative endpoints, so process scheduling cannot omit either edge of the gesture.

Sampling is limited to the held-button interval and follows that monitor's presentation cadence. Retained drawing points are distance-filtered and capped. The stroke model tracks extrema separately, so history compaction cannot shrink the eventual capture bounds.

Alternative considered: collect `Gtk.EventControllerMotion` events from the new overlay. Rejected as the sole source because a surface mapped after the press cannot reliably acquire the existing Wayland pointer grab.

Alternative considered: add a permanent input overlay. Rejected because it would intercept normal desktop input while the feature is idle.

### Render one click-through surface per monitor

AGS creates a temporary full-monitor overlay for each current GDK monitor. Each drawing area receives the same global polyline and translates it by that monitor's global logical origin. Cairo clipping limits each surface to its monitor automatically. The renderer spatially resamples at 18 px and converts a clamped uniform cubic B-spline into Cairo Bézier segments. The spline approximates interior jitter, remains C2-continuous, and reaches the exact endpoints while changing only its local tail as samples arrive; raw points remain authoritative for capture extrema. Each cubic is exactly subdivided into four equivalent curves before proportional glow layers are rendered in up to 48 contiguous age bands. Smoothstep-based opacity and width increase toward the cursor, and each stable segment retains its first monotonic presentation time so opacity also fades over a 1.4-second lifetime. Internal bands use butt caps so fading cannot create round-cap overlap nodes, while one explicit round cap per layer restores the leading edge. One shared 32 px brush radius determines the outer line width and capture padding; proportional accent layers form a saturated rounded core and two low-alpha shoulders without separate cursor halos or desktop blur. Release starts Hyprland's `fade` animation for `ags-ai-pointer-drawing` and waits for its bounded completion before capture. After `grim` succeeds, geometry-sized click-through `ags-ai-pointer-selection-preview` surfaces are anchored at the captured region rather than stretched across each monitor. They use the same 16% accent fill, 2 px border, rounded corners, and restrained shadow hierarchy as PiP snap preview. Their subtle compositor `popin 98%` therefore originates from the selection itself, and they remain owned by the capture popup lifecycle. Both namespaces disable screen sharing.

The controller owns the stroke and sampling source. The view owns windows, drawing areas, and Cairo rendering. Release awaits GTK unmapping, synchronizes the display, and allows two compositor frames before `grim` runs so the captured image cannot include the trail. The separate review panel retains its namespace-specific `popin` style.

Alternative considered: one desktop-sized window. Rejected because layer-shell surfaces are output-scoped and a single surface does not represent arbitrary multi-monitor layouts.

### Derive a padded axis-aligned rectangle from stroke extrema

The pure stroke policy records minimum and maximum global X/Y values across every accepted sample. Completion requires minimum raw width and height, adds fixed padding on all sides, and then applies the existing safe-integer and maximum-pixel validation.

This intentionally captures a rectangle, not a polygon mask. A square, circle, or loose outline therefore produces the same predictable contract: all enclosed content plus small surrounding context.

Alternative considered: infer a rectangle from only the first and last point. Rejected because closed gestures end near their start and collapse to an empty selection.

Alternative considered: snap to an accessible element now. Deferred because semantic ambiguity and accessibility availability should not affect the first drawing interaction. The installed AT-SPI runtime remains available for a later reviewed enrichment layer.

### Keep the existing request boundary

Hyprland continues to send closed `start` and `finish` requests with global coordinates. Intermediate points remain inside AGS and do not expand the component request API. This preserves synchronous endpoint capture and avoids high-frequency process requests from compositor callbacks.

## Risks / Trade-offs

- [Synchronous cursor IPC stalls a frame] -> Sample only during activation, use the direct Unix socket helper, keep the cadence bounded, and stop immediately on every terminal path.
- [Very fast motion falls between samples] -> Keep authoritative endpoints, use a short cadence, and add capture padding; exact freehand shape reproduction is not required.
- [Monitor layout changes during drawing] -> Snapshot monitor surfaces at activation and derive capture geometry from global compositor coordinates; cancellation and the next activation rebuild the surfaces.
- [The fading trail appears in the screenshot] -> Exclude the namespace from screen sharing, await a bounded compositor fade and unmapping, synchronize the display, and delay capture by two frames.
- [A stroke has huge or degenerate bounds] -> Require two-dimensional extent and reuse the existing maximum pixel-area limit before capture.

## Migration Plan

1. Add and test the pure bounded stroke model and padded geometry policy.
2. Add activation-scoped cursor sampling and click-through monitor overlays.
3. Replace endpoint rectangle derivation with completed-stroke geometry while retaining the request contract.
4. Validate overlay cleanup, capture exclusion, multi-monitor coordinates, preview, and cancellation.
5. Roll back by restoring endpoint geometry in the controller; capture and preview contracts remain unchanged.

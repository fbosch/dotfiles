## Why

Endpoint rectangles do not match the intended interaction: the user wants to draw around desktop content and capture the area implied by the complete gesture. A visible stroke makes that area explicit without requiring semantic inference in the first slice.

## What Changes

- Replace endpoint-only rectangle selection with a visible `Super + middle-button` drawing gesture.
- Record a bounded global pointer path only while the gesture is active.
- Derive the capture rectangle from the stroke's padded coordinate bounds.
- Render the stroke on click-through AGS overlay surfaces across all monitors.
- Show a configurable accent outline around the compositor cursor only while drawing is active.
- Reject tiny, invalid, or oversized stroke bounds before capture.
- Preserve the existing local capture preview, consent boundary, private storage, and cancellation behavior.
- Keep AT-SPI available as a future enrichment input, but do not inspect accessibility data or alter capture bounds semantically in this change.

## Capabilities

### New Capabilities

- `ags-ai-pointer-stroke-selection`: Provides explicit drawing feedback and deterministic capture bounds derived from a bounded pointer stroke.

### Modified Capabilities

- None.

## Impact

- Extends `.config/ags/components/ai-pointer/` with bounded stroke geometry and multi-monitor drawing surfaces.
- Adds a Hyprland-version-pinned cursor-outline plugin, NixOS packaging, and `.config/hypr/` styling for drawing-time cursor feedback.
- Keeps the existing Hyprland press/release request contract while AGS samples cursor positions during the active gesture.
- Retains the NixOS AT-SPI runtime as a dormant prerequisite for future target enrichment; this change does not consume accessibility data.
- Depends on the capture, cleanup, preview, and read-only boundaries established by `ags-ai-pointer-query`.

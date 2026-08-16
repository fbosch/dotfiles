## 1. Stroke Policy

- [x] 1.1 Add a pure bounded stroke model with distance filtering, retained extrema, and deterministic history compaction.
- [x] 1.2 Derive padded capture geometry from complete-stroke extrema and enforce minimum extent plus the existing maximum capture area.
- [x] 1.3 Add tests for closed strokes, negative origins, sparse samples, compaction, tiny gestures, and oversized bounds.

## 2. Drawing Surface

- [x] 2.1 Add temporary click-through AGS drawing surfaces for every current monitor.
- [x] 2.2 Render one global stroke across monitor-local Cairo canvases and hide all canvases before capture.
- [x] 2.3 Ensure cancellation, failure, repeated activation, and shutdown destroy or hide every drawing resource.

## 3. Gesture Integration

- [x] 3.1 Add an activation-scoped GLib cursor sampler using the existing direct Hyprland IPC helper.
- [x] 3.2 Keep Hyprland press and release coordinates as authoritative stroke endpoints and preserve release-before-start handling.
- [x] 3.3 Replace endpoint-only rectangle capture with validated completed-stroke geometry.
- [x] 3.4 Keep stroke coordinates local and leave accessibility inspection inactive in this change.

## 4. Validation

- [x] 4.1 Run targeted pure AI Pointer tests and native GJS lifecycle tests.
- [x] 4.2 Run AGS bundle, scoped formatting/linting, and `hyprctl configerrors`.
- [x] 4.3 Strictly validate the OpenSpec change and verify AI Commit remains unchanged.
- [ ] 4.4 Manually verify square/circle drawing, cross-monitor trails, capture accuracy, preview, and Escape/discard cleanup.

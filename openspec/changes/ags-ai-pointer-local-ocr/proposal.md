## Why

The AI Pointer preview can expose visible text as useful local context, but the existing OCR keybind performs a second screenshot through a `grim` path with confirmed native crashes. OCR should reuse the one reviewed AI Pointer capture without increasing screenshot activity or leaking recognized text.

## What Changes

- Run local Tesseract asynchronously against the existing validated capture after the preview is visible.
- Bound decoded image pixels, wall time, process concurrency, and stdout while streaming.
- Show selectable local OCR states and text in the preview metadata panel.
- Cancel OCR with its owning run and keep text out of capture metadata, logs, clipboard, notifications, and AI payloads.

## Capabilities

### New Capabilities

- `ags-ai-pointer-local-ocr`: bounded local OCR enrichment of an existing AI Pointer preview.

### Modified Capabilities

- None.

## Impact

- `.config/ags/components/ai-pointer/`: OCR subprocess boundary, controller lifecycle, preview UI, styles, and tests.
- The existing capture implementation, Hyprland OCR keybind, and window-preview daemon remain unchanged.

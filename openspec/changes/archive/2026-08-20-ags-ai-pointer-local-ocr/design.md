## Context

AI Pointer already creates one private validated PNG and keeps it until the preview is discarded. Tesseract 5.5.3 and English language data are installed locally. The separate OCR keybind is unsuitable for reuse because it invokes `grimblast`, creates derivative files, and copies or notifies recognized text.

## Decisions

### Reuse the reviewed capture

OCR receives the exact capture path and decoded texture dimensions returned by the preview. It never invokes `grim`, `grimblast`, the screenshot script, clipboard commands, or notifications. Images above six million decoded pixels are not processed.

### Keep OCR advisory and asynchronous

The existing machine enters preview immediately. The controller owns one cancellable Tesseract subprocess as a side lifecycle and updates a local OCR field when bounded output arrives. OCR failure never fails or hides a valid capture. Run IDs and cancellation prevent stale results from updating a later preview.

### Bound resources and data flow

Tesseract runs directly through argv with English, OEM 1, PSM 3, a 300 DPI hint, and `OMP_THREAD_LIMIT=1`. The process has a ten-second timeout and stdout is capped at 64 KiB while reading 4 KiB chunks. Text is strict UTF-8, control-minimized, selectable plain text and remains only in process/controller/widget memory.

## Risks / Trade-offs

- [Existing capture path remains unstable] -> Do not add a second screenshot; OCR starts only after the existing capture succeeds.
- [OCR consumes CPU or memory] -> Limit pixels, one process, one thread, output, and wall time.
- [Recognized text is sensitive] -> Keep it local, literal, transient, and excluded from all payload and persistence contracts.
- [Large text expands the UI] -> Place OCR in a bounded scroll area with character wrapping.

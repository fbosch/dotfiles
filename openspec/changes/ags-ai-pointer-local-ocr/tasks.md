## 1. Bounded OCR Boundary

- [x] 1.1 Add direct-argv Tesseract execution with pixel, timeout, concurrency, and streaming-output limits.
- [x] 1.2 Normalize bounded UTF-8 output and represent text, no-text, truncation, cancellation, and unavailable outcomes.

## 2. Preview Lifecycle

- [x] 2.1 Start OCR asynchronously from the existing shown capture and own it with run cancellation.
- [x] 2.2 Render selectable local OCR states in a bounded preview metadata region and clear them on teardown.

## 3. Validation

- [x] 3.1 Add native tests for bounded streaming and controller reuse of the existing capture.
- [ ] 3.2 Manually verify text, no-text, oversized, timeout, and cancellation outcomes without invoking another screenshot command.

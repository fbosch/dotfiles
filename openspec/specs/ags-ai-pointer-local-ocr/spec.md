## Purpose

Show bounded local text recognition alongside an existing reviewed AI Pointer capture without performing another screenshot or exposing recognized text externally.

## Requirements

### Requirement: Reuse the existing capture
The AI Pointer SHALL run OCR only against the exact private validated image already shown in the current preview. OCR SHALL NOT invoke `grim`, `grimblast`, another screenshot command, image preprocessing, clipboard commands, or notifications.

#### Scenario: Preview becomes available
- **WHEN** the existing capture is decoded and shown successfully
- **THEN** the system may start one local OCR process with that capture path and its decoded pixel dimensions

#### Scenario: Preview cannot be shown
- **WHEN** capture decoding or presentation fails
- **THEN** no OCR process starts

### Requirement: Bounded cancellable OCR
OCR SHALL process no more than six million decoded pixels, run at most one process per AI Pointer run, retain no more than 65,536 stdout bytes while streaming, and stop after ten seconds. Cancellation, discard, shutdown, or a newer run SHALL terminate work and reject stale output.

#### Scenario: Capture exceeds the pixel limit
- **WHEN** decoded width multiplied by height exceeds six million pixels
- **THEN** OCR reports an unavailable state without spawning Tesseract

#### Scenario: OCR output exceeds the byte limit
- **WHEN** stdout crosses 65,536 bytes
- **THEN** the process is terminated and only a valid bounded prefix is shown as truncated output

#### Scenario: Run is cancelled
- **WHEN** OCR is pending or complete and the owning preview is discarded
- **THEN** the process is terminated, transient text is cleared, and late output cannot update another run

### Requirement: Local-only OCR presentation
The preview SHALL show pending, recognized text, no-text, truncated, and unavailable OCR states as literal selectable text in a bounded scroll region. OCR text MUST NOT be persisted, logged, notified, copied automatically, added to capture or accessibility metadata, or included in an AI-facing payload.

#### Scenario: Tesseract recognizes text
- **WHEN** bounded valid UTF-8 output completes successfully
- **THEN** the local preview shows the normalized selectable text without interpreting markup or links

#### Scenario: OCR fails
- **WHEN** Tesseract is missing, times out, fails, or returns invalid output
- **THEN** the preview remains usable and shows only a stable local unavailable message

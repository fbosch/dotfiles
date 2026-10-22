# Spec Delta

## Purpose

Provide compact, read-only inspection of live and historical subagents inside Pi, with clear attention states and deliberate human cancellation controls.

## ADDED Requirements

### Requirement: Foreground and background presentation
Foreground progress SHALL appear inline with its tool call. Background workers SHALL appear in a bounded widget above the editor while running, queued, or waiting for an answer. Finished workers SHALL move to parent-scoped history, with completion receipts retained in the conversation.

#### Scenario: Background completion
- **WHEN** a background worker settles
- **THEN** its live row leaves the widget, its history remains accessible, and its completion receipt remains available without a permanent finished row

### Requirement: Attention-first bounded widget
The widget SHALL default to at most four worker rows, prioritizing unanswered questions, then running workers, then queued workers. Launch order SHALL remain stable within each state. Overflow SHALL use a "+N more" row. Error and cleanup-unknown warnings SHALL remain visible separately when needed. The row limit SHALL be configurable and adapt to terminal space.

#### Scenario: More workers than visible rows
- **WHEN** the parent has two question-waiting, three running, and two queued workers
- **THEN** the default widget shows the two waiting workers and first two running workers, plus an overflow indicator, with all workers accessible in the overlay

#### Scenario: Narrow terminal with cleanup uncertainty
- **WHEN** terminal space is constrained and a worker's cleanup is uncertain
- **THEN** the widget reduces ordinary rows without hiding the delegation-blocking warning or crowding out the editor

### Requirement: Concise rows and detailed metrics
Normal widget rows SHALL show worker name, state, current activity, and elapsed time rather than routine model, token, or cost details. The overlay SHALL show resolved model, turn budget, reported usage/cost, timestamps, and errors. Missing metrics SHALL be marked unavailable; budget exhaustion and context pressure SHALL remain eligible for compact-row warnings.

#### Scenario: Usage not reported
- **WHEN** a provider supplies no cost or token metric for a worker
- **THEN** the overlay identifies that metric as unavailable rather than displaying a fabricated zero or estimate

### Requirement: One native inspection overlay
The `/subagents` command SHALL open one native Pi overlay containing the owned worker list, final results, and read-only transcripts. Navigation SHALL use standard Pi list/scroll/focus conventions, Enter to inspect, and Escape to return to the list then close. V1 SHALL NOT require a new global shortcut, terminal multiplexer, child message editor, or session takeover.

#### Scenario: Inspect and return
- **WHEN** the user opens `/subagents`, selects a worker, presses Enter, and then Escape
- **THEN** the transcript opens read-only and Escape returns to the list with its prior worker selection

### Requirement: Event-driven transcript following
Running transcripts SHALL initially follow the latest output. Manual upward scrolling SHALL pause following without losing position when new output arrives. An explicit "Follow latest" action SHALL resume it. Returning to a worker SHALL preserve selection and scroll state. Refresh SHALL use worker events rather than repeated polling.

#### Scenario: User reads earlier output
- **WHEN** the user scrolls upward while a worker continues producing output
- **THEN** the transcript remains at the user's position until "Follow latest" is selected

#### Scenario: Return to the same transcript
- **WHEN** the user returns to the list and reopens the same worker
- **THEN** its prior scroll/follow state is preserved rather than reset to the bottom

### Requirement: Explicit cancellation controls
The overlay SHALL provide labeled cancel-one and cancel-all actions with confirmation, using the same lifecycle controls as the parent tools. V1 SHALL NOT add single-key destructive actions or direct child messaging. Controls SHALL distinguish active, stopping, historical, released, and cancelled workers so an unavailable operation is not presented as executable.

#### Scenario: Cancellation confirmation declined
- **WHEN** the user selects cancel-all but declines confirmation
- **THEN** no worker is cancelled

#### Scenario: Cancellation pending
- **WHEN** a user confirms cancellation of a running worker
- **THEN** the overlay displays stopping until shutdown is confirmed and does not report immediate success

#### Scenario: Historical worker
- **WHEN** the user inspects a saved worker after Pi restarts
- **THEN** its report/transcript is readable without a live cancellation or continuation control

### Requirement: Observational UI and clear failures
Inspecting workers SHALL NOT create model turns, rerun assignments, or change child configuration. The UI SHALL distinguish execution failures, failed history persistence, and cleanup uncertainty. It SHALL NOT imply that worker conclusions are verified simply because execution completed.

#### Scenario: Report save failed
- **WHEN** a worker executed successfully but its report was not saved durably
- **THEN** the overlay shows the execution outcome and storage failure separately and offers available in-memory evidence without claiming complete saved history

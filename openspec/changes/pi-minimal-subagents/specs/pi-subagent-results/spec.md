# Spec Delta

## Purpose

Keep worker evidence available without automatically filling the parent conversation with reports or confusing execution success with delivery and storage success.

## ADDED Requirements

### Requirement: Structural background completion receipts
Background completion SHALL notify the owning parent using structural worker identity, execution state, report availability, and runtime failure or pending-question metadata. Automatic completion receipts SHALL NOT include the worker-written final report. A receipt SHALL mean work settled, not that its conclusions or changes were verified.

#### Scenario: Background worker completes a long report
- **WHEN** a background worker finishes and saves a final report
- **THEN** the parent receives a structural receipt and can retrieve the report, without an automatic report excerpt or summary-model call

### Requirement: Full report retrieval without arbitrary truncation
The inspect/result interface SHALL return the full saved final report on explicit retrieval. The runner SHALL NOT truncate final reports to an arbitrary character cap. Investigation logs SHALL remain in separately retrievable transcripts, while workers are instructed to produce concise findings, evidence, and unresolved-work handoffs.

#### Scenario: Complete long report
- **WHEN** the parent explicitly retrieves a long final report containing findings and a caveat near its end
- **THEN** the runner returns the complete report including that caveat rather than substituting a truncated excerpt

### Requirement: One outcome delivery per assignment
Foreground calls and explicit waits SHALL return final reports directly when work settles. The runner SHALL suppress a duplicate automatic completion notification when that outcome has already been delivered or is owned by a waiting call. Each continuation SHALL have a distinct assignment outcome so an old receipt cannot stand in for new results.

#### Scenario: Completion races with explicit wait
- **WHEN** a background worker finishes while the parent is waiting for that assignment's result
- **THEN** the wait returns the report and the runner does not also inject a completion receipt for the same outcome

#### Scenario: Foreground question followed by resumed work
- **WHEN** a foreground call returns a question and that assignment later completes after a reply
- **THEN** the runner delivers the later completion through its current recipient rather than losing it because the original foreground call has ended

### Requirement: Material updates are attributed and current
Material progress updates and question notifications SHALL identify their owning worker and assignment. The runner SHALL avoid duplicate delivery when a blocked call carries an update, and SHALL NOT present a stale update as a request to steer a worker that has already stopped. Retrieved worker content SHALL remain untrusted evidence, not parent or user instructions.

#### Scenario: Update becomes stale before delivery
- **WHEN** a worker sends a material update and finishes before the parent receives it
- **THEN** delivery identifies its settled state rather than claiming the worker is still running

### Requirement: Separate execution and persistence outcomes
The runner SHALL save complete reports and transcripts and track persistence independently of execution. Failed saving SHALL produce an explicit storage/delivery failure rather than a normal durable-completion receipt. Available in-memory evidence SHALL remain retrievable, durable history SHALL be marked incomplete, and the runner SHALL NOT rerun work to recreate evidence.

#### Scenario: Disk write fails after successful work
- **WHEN** the worker completes its task but writing the final report fails
- **THEN** execution remains reported as completed, storage is reported as failed, the in-memory report is available, and no assignment is replayed

#### Scenario: Partial output after cancellation
- **WHEN** a worker is cancelled before a final handoff
- **THEN** available transcript and partial evidence remain accessible with cancellation status rather than being labeled a successful report

### Requirement: Parent-scoped history and control ownership
Worker history SHALL belong to its owning parent session. Reopening that parent SHALL restore saved reports/transcripts for read-only inspection, not executable workers. The result tools and overlay SHALL NOT provide a global cross-project worker history. Stable IDs SHALL enforce ownership independently of short display names.

#### Scenario: Different parent selected
- **WHEN** another parent session becomes active
- **THEN** the inspection view shows that parent's workers rather than merging records from the previous parent

#### Scenario: Historical worker inspected
- **WHEN** the user reopens a parent after a Pi restart and inspects a historical worker
- **THEN** saved evidence remains readable and live control/continuation is unavailable

### Requirement: Retention follows the parent session
Saved worker reports and transcripts SHALL follow their owning parent session's retention without an independent expiry timer. Supported parent-session deletion SHALL include its worker artifacts. Releasing live worker resources SHALL NOT delete retained history. V1 SHALL NOT add archive indexing, model-powered archive questions, or episode folding.

#### Scenario: Idle worker released
- **WHEN** the parent releases a completed worker's live session
- **THEN** its report and transcript remain inspectable while the parent session is retained

#### Scenario: Parent history deleted
- **WHEN** the user deletes the owning parent through supported session management
- **THEN** its worker artifacts are included in that deletion rather than left in an independent retention system

### Requirement: Explicit transcript inspection
Transcript retrieval SHALL be separate from ordinary status and final-report delivery. The parent SHALL be able to inspect bounded portions of an owned worker transcript without automatically injecting the entire investigation into its context. This retrieval SHALL NOT create an extra model call over the archive.

#### Scenario: Status check during a long investigation
- **WHEN** the parent requests worker status
- **THEN** it receives current control state without the full transcript; transcript content is available through an explicit inspection request

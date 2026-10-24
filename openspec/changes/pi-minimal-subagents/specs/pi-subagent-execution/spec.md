# Spec Delta

## Purpose

Define predictable specialist execution and control within a parent Pi session, including explicit capability boundaries, scheduling, communication, and safe shutdown.

## ADDED Requirements

### Requirement: Single-worker launch and execution modes
The runner SHALL launch one full in-process Pi child session per launch request, default to background execution, and support explicit foreground execution. The parent SHALL coordinate batches and dependent assignments rather than relying on a runner workflow engine.

#### Scenario: Default launch
- **WHEN** the parent launches a specialist without specifying an execution mode
- **THEN** the call returns a worker ID without waiting for completion and the worker runs or enters the shared queue

#### Scenario: Foreground launch
- **WHEN** the parent explicitly launches a foreground worker
- **THEN** the launch waits for completion or another return condition defined by the wait contract, with progress shown inline

### Requirement: Three focused parent interfaces
The runner SHALL expose focused launch, inspect/wait, and control tools. Control actions SHALL distinguish steering, question replies, continuation, cancellation, and live-session release. Internal worker IDs SHALL identify owned workers independently of display labels. Routed prompt commands SHALL use the same launch contract.

#### Scenario: Routed launch
- **WHEN** an existing routed prompt launches a specialist
- **THEN** the request uses the same preflight, queue, budget, lifecycle, and result delivery as a tool launch

#### Scenario: Foreign worker ID
- **WHEN** the parent attempts to inspect or control a worker owned by another parent session
- **THEN** the runner rejects the request rather than resolving by a display label or crossing session ownership

### Requirement: Named specialist configuration
The runner SHALL retain Markdown specialist definitions and model preset integration. Specialist definitions SHALL supply role instructions, tool allowlists, scoped skills, and turn-budget defaults. Model and thinking overrides SHALL be rejected unless the specialist explicitly permits them. Launch arguments MUST NOT expand tools, capability bundles, or mandatory policies.

#### Scenario: Disallowed model override
- **WHEN** a launch overrides a specialist model without permission in that definition
- **THEN** preflight fails with a specific error instead of changing or silently ignoring the requested model

#### Scenario: Allowed general-worker override
- **WHEN** a specialist explicitly permits a model override and that model resolves successfully
- **THEN** the resolved child configuration uses that override without expanding its tool permissions

### Requirement: Explicit child capabilities and preflight
Children SHALL load centrally defined capability bundles and a mandatory baseline for required policies and model/provider support, not the parent's ambient extension set. Bundle selection MUST NOT grant tools outside the specialist allowlist. Missing required tools, extensions, presets, or policies SHALL fail preflight before worker execution.

#### Scenario: Missing required integration
- **WHEN** a launch cannot resolve a required provider hook or tool-backing extension
- **THEN** no assignment starts and the launch identifies the missing requirement without falling back to an unrestricted child

#### Scenario: Bundle contains additional tools
- **WHEN** a selected bundle backs tools not included in the specialist allowlist
- **THEN** those tools remain unavailable to the child

### Requirement: Scoped on-demand skills
A child SHALL receive only its available explicitly selected skills, with names and descriptions available at startup and full instructions loaded on demand. Missing selected skills SHALL NOT block startup or cause implicit skill selection. Required safety policies SHALL remain in the mandatory baseline rather than depend on optional skill invocation.

#### Scenario: Specialist starts
- **WHEN** a worker is created with a selected skill set
- **THEN** its catalog excludes unselected parent skills and does not preload full selected skill text

#### Scenario: Selected skill is missing
- **WHEN** a selected skill is missing from the catalog or disk, or omitted by the SDK loader
- **THEN** startup proceeds with the remaining explicitly selected skills, records skipped names in the child system prompt and assignment transcript, and does not load substitute or ambient skills

### Requirement: Fresh or textual parent context
Workers SHALL start with fresh conversation context unless textual inheritance is requested. Inheritance SHALL include parent user/assistant text and compaction summaries, excluding tool-result roles and non-text content. Shared project instructions and specialist identity SHALL remain applicable in either mode. The runner MUST NOT implement a true conversation fork.

#### Scenario: Textual inheritance
- **WHEN** a parent conversation contains user text, assistant text, a compaction summary, tool output, and an image
- **THEN** an inheriting worker receives the textual conversation and summary but not the tool output or image, and retains its specialist identity

#### Scenario: Fresh specialist
- **WHEN** inheritance is not requested
- **THEN** the child receives its assignment and applicable instructions without copying parent conversation history

### Requirement: Stable live-session configuration
The resolved role, model, thinking, tools, extensions, skills, and policies SHALL remain fixed throughout a worker's live session. Steering, question replies, and continuation SHALL NOT re-resolve configuration or expand capabilities. Configuration changes SHALL apply to newly launched workers.

#### Scenario: Specialist file changes
- **WHEN** a specialist definition changes after a worker finishes an assignment and that worker is continued
- **THEN** it continues with its original resolved configuration; a different configuration requires a new worker

### Requirement: Parent-only delegation and workspace coordination
Only the parent SHALL spawn workers. Children MUST NOT receive nested delegation capability. Workspace ownership and conflict avoidance SHALL remain parent-instruction responsibilities; v1 SHALL NOT add workspace locks, overlap rejection, automatic worktree creation, or merging.

#### Scenario: Worker needs another specialist
- **WHEN** a worker needs work outside its assignment or capabilities
- **THEN** it reports that need to the parent rather than launching a descendant

#### Scenario: Shared checkout
- **WHEN** the parent launches workers in the same worktree
- **THEN** the runner applies its normal scheduling rules without claiming runtime file-ownership enforcement

### Requirement: Shared execution capacity
Foreground and background work SHALL share a concurrency limit of six execution slots. Excess launches and continuations SHALL queue. Idle completed workers and workers waiting for parent answers SHALL consume no execution slot. A stopping worker SHALL retain its slot until its execution is confirmed stopped.

#### Scenario: Foreground work at capacity
- **WHEN** six workers occupy execution slots and a foreground launch arrives
- **THEN** the foreground worker queues rather than bypassing the limit

#### Scenario: Reply while capacity is full
- **WHEN** a matching answer makes a waiting worker runnable while all slots are occupied
- **THEN** its resumption queues without exceeding the shared limit

### Requirement: Assignment turn budgets
Specialists SHALL default to 12 turns for discovery/routine roles and 24 for implementation/deep-analysis roles, preserving lower specialist limits. Explicit assignment overrides SHALL be supported. Workers SHALL receive a wrap-up warning with two turns remaining and stop at the hard limit, reporting incomplete work when applicable. V1 SHALL impose no additional worker wall-clock deadline.

#### Scenario: Budget exhausted during tool work
- **WHEN** a worker reaches its assignment's turn ceiling without a final handoff
- **THEN** it stops at that boundary and reports budget exhaustion and available partial evidence without claiming successful completion

### Requirement: Correlated questions preserve assignment budget
A question SHALL create an identifiable pending question, yield the worker's execution slot, and retain its live session. A reply SHALL require the owning worker ID and current question ID. Waiting SHALL consume no turns, and answering SHALL preserve the remaining assignment budget. The parent SHALL be able to explicitly extend that budget rather than receiving an implicit reset.

#### Scenario: Stale answer
- **WHEN** a reply names a question already answered or superseded
- **THEN** the runner rejects it without treating the text as steering or a new assignment

#### Scenario: Repeated questions
- **WHEN** a worker asks multiple questions within one assignment
- **THEN** replies do not replenish its turn allowance and each resumed segment uses the remaining budget

### Requirement: Material updates and steering
Workers SHALL report material findings or blockers without ending their assignment, and parents SHALL be able to steer running workers. Routine tool activity SHALL update presentation state rather than generate conversational progress messages. Worker text SHALL remain attributed as worker output, not user authorization or verified conclusions.

#### Scenario: Material finding
- **WHEN** a worker sends a material finding while the parent is free to receive updates
- **THEN** the parent receives an attributed update, distinct from a final result, while the worker can continue

#### Scenario: Ordinary tool activity
- **WHEN** a worker begins a routine read
- **THEN** its activity display updates without injecting a separate conversational progress message

### Requirement: Wait return conditions
Foreground launch and explicit wait SHALL return on completion, failure, confirmed cancellation, budget exhaustion, cleanup uncertainty, a pending parent question, or wait timeout. A question return SHALL expose the exact worker/question IDs and question text. A wait timeout SHALL NOT cancel the worker.

#### Scenario: Foreground worker asks a question
- **WHEN** a foreground worker requires a parent decision
- **THEN** the blocked call returns the pending question so the parent can answer instead of deadlocking

#### Scenario: Background wait expires
- **WHEN** an explicit wait reaches its caller-specified timeout while the worker continues
- **THEN** it returns the current state and states that the worker was not cancelled

### Requirement: Native recovery and explicit continuation
Children SHALL use Pi's normal request retry and compaction. The runner SHALL NOT automatically restart assignments or spawn replacements. The parent SHALL explicitly continue retained sessions after clean completion, budget exhaustion, or a recoverable failure, with a fresh bounded assignment. Continuation SHALL NOT replay prior tool actions automatically.

#### Scenario: Provider failure after an edit
- **WHEN** a worker fails after changing a file
- **THEN** it reports failure and partial evidence without rerunning the assignment; the parent chooses whether a safe continuation is appropriate

#### Scenario: Completed worker receives a follow-up
- **WHEN** the parent continues a cleanly stopped worker with a new bounded assignment
- **THEN** the same live session resumes with a fresh assignment budget and its existing configuration

### Requirement: Cancellation and parent interrupt semantics
Cancellation SHALL distinguish requested stopping from confirmed termination. Escape SHALL stop the parent's current work and a foreground worker it is awaiting, but preserve independent background workers. Interrupting a wait on a background result SHALL end the wait only. Explicitly cancelled workers SHALL NOT be continued.

#### Scenario: Background wait interrupted
- **WHEN** the user interrupts the parent while it waits on a background result
- **THEN** the wait ends and that background worker remains running unless separately cancelled

#### Scenario: Queued or question-waiting worker cancelled
- **WHEN** the parent or user explicitly cancels a queued or question-waiting worker
- **THEN** queued execution is removed or the pending question is cleared, partial history remains available, and the worker cannot be continued

#### Scenario: Running worker cancelled
- **WHEN** cancellation is requested for a running worker
- **THEN** it remains stopping and retains its slot until execution is confirmed stopped; confirmed cancellation is not a successful final report

### Requirement: Cleanup uncertainty blocks delegation
If shutdown cannot be confirmed, the runner SHALL expose a cleanup-unknown state, retain diagnostics and the uncertain execution reservation, and block new launches and continuations until Pi restarts. It SHALL NOT infer that a cancellation request stopped an active tool.

#### Scenario: Abort does not establish shutdown
- **WHEN** cancellation or teardown cannot confirm worker execution has stopped
- **THEN** the runner reports cleanup uncertainty and refuses further delegation rather than freeing capacity and continuing normally

### Requirement: Live-session retention and release
Eligible idle worker sessions SHALL remain resumable for the lifetime of their owning parent session without inactivity expiry or an idle-count eviction policy. Explicit release, parent teardown, reload, or Pi exit SHALL end live continuation. Reports and transcripts SHALL remain readable under the history contract; a restart SHALL NOT reconstruct executable workers.

#### Scenario: Parent reopened after restart
- **WHEN** a parent session is reopened in a new Pi process
- **THEN** its worker history is readable but control requests cannot revive those saved workers

### Requirement: Session switch and reload teardown
A parent-session switch SHALL require confirmation before cancelling running/queued workers and releasing retained sessions. Reload SHALL terminate live workers and release their sessions rather than transfer them between extension instances. Reload SHALL warn when the host supports confirmation and otherwise disclose interrupted work. Cleanup uncertainty SHALL remain a delegation block.

#### Scenario: User declines session switch cancellation
- **WHEN** a switch would interrupt running work and the user declines confirmation
- **THEN** the switch does not proceed through the runner's supported switch integration

#### Scenario: Reload interrupts work
- **WHEN** the extension reloads with live workers
- **THEN** workers are shut down, interrupted work is disclosed, saved history remains inspectable, and the new instance does not claim executable continuation

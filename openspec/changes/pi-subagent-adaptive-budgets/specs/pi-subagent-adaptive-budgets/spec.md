# Spec Delta

## Purpose

Provide optional, task-aware turn-budget advice and bounded extensions without making classifier setup a prerequisite for delegation, changing worker permissions, or weakening deterministic execution limits.

## ADDED Requirements

### Requirement: Classifier budgeting is progressive enhancement
The runner SHALL preserve fixed-budget operation and explicit parent extensions when classifier setup is missing, disabled, unsupported, or unusable. Optional classifier failures SHALL NOT prevent startup or worker launch. A configured specialist ceiling SHALL remain authoritative regardless of classifier availability.

#### Scenario: No classifier setup
- **WHEN** a parent launches a worker without usable classifier setup
- **THEN** the worker uses its deterministic allowance and ordinary parent controls without a setup requirement or automatic extension

#### Scenario: Configured classifier cannot authenticate
- **WHEN** the configured classifier cannot authenticate at a budget checkpoint
- **THEN** the worker retains its allowance, normal wrap-up remains available, and an actionable diagnostic is reported without failing the launch or granting extra turns

### Requirement: Capability checks are passive
Classifier eligibility SHALL use existing local configuration, trust, and registry information. Startup, launch preflight, status inspection, and rendering SHALL NOT probe classifier providers, refresh credentials, or create model requests solely to discover availability.

#### Scenario: Inspect without classifier setup
- **WHEN** the user starts Pi, launches a worker, or inspects its budget without classifier setup
- **THEN** those operations do not generate classifier network requests or repeated setup warnings

### Requirement: Initial allowance and specialist ceiling are distinct
An assignment SHALL use explicit `maxTurns` or its specialist's `max_turns` as its initial allowance. Specialist configuration SHALL accept optional `hard_max_turns`. An assignment's `hardMaxTurns` SHALL NOT exceed that ceiling. Invalid or overflowing limits SHALL be rejected before execution, and a configured assignment ceiling SHALL remain fixed.

#### Scenario: Initial allowance below the ceiling
- **WHEN** a worker starts with maxTurns 16 and a configured ceiling of 24
- **THEN** its initial and currently granted allowances are 16, its ceiling is 24, and the unused ceiling is not automatically granted

#### Scenario: Explicit ceiling equals the specialist ceiling
- **WHEN** an assignment starts at 16 turns and explicitly requests hardMaxTurns 24 under a specialist ceiling of 24
- **THEN** validation accepts the unchanged ceiling while granting only the initial 16 turns

#### Scenario: Parent attempts to raise the ceiling
- **WHEN** an assignment requests hardMaxTurns above its specialist ceiling, below its initial allowance, or without a configured specialist ceiling
- **THEN** the runner rejects the budget configuration before executing that assignment

#### Scenario: No specialist ceiling
- **WHEN** a specialist has no hard_max_turns
- **THEN** automatic grants are disabled and the fixed-budget flow retains its existing explicit-extension controls

### Requirement: Automatic grants have deterministic bounds
Automatic grants SHALL add at most four turns each, occur at most twice per assignment, and never exceed the configured ceiling. Code SHALL calculate each increment and reject unsafe arithmetic. Manual extensions SHALL obey any configured ceiling without resetting automatic-grant or classifier-check counts.

#### Scenario: Two bounded grants
- **WHEN** an eligible assignment starts at 16 turns with a ceiling of 24 and receives two approved automatic grants
- **THEN** its allowance progresses to 20 and then 24, and no third automatic grant is permitted

#### Scenario: Less than a full increment remains
- **WHEN** an eligible assignment has an allowance of 16 and a ceiling of 18
- **THEN** an automatic grant adds at most two turns

#### Scenario: Manual extension after a nudge
- **WHEN** the parent explicitly extends an eligible assignment after an automatic grant
- **THEN** the configured ceiling and already consumed automatic-grant and classifier-check counts still apply

### Requirement: Advice precedes automatic enablement
Usable classifier setup and a specialist ceiling SHALL enable advisory checks by default, not automatic spending. Automatic grants SHALL additionally require explicit enablement and a reviewed confidence threshold supported by evaluation evidence. Advisory results SHALL NOT change the granted allowance.

#### Scenario: Advisory result recommends more work
- **WHEN** an advisory check recommends an increment
- **THEN** the recommendation is inspectable while the worker's allowance and ordinary stop boundary remain unchanged

#### Scenario: Automatic readiness is incomplete
- **WHEN** classifier setup is usable but automatic mode lacks its reviewed threshold or enablement
- **THEN** checks remain non-granting and any incomplete automatic configuration is disclosed without making delegation depend on the classifier

### Requirement: Budget judgments cannot authorize capabilities
Classifier output SHALL be a typed progress judgment, not a turn count, command, permission, or completion verdict. A positive judgment SHALL only inform a grant already permitted by deterministic policy. Pending questions, known approval requirements, cleanup blocks, and ineligible lifecycle states SHALL prevent automatic grants.

#### Scenario: Worker requests permission through an update
- **WHEN** worker-authored evidence asks for broader tools, bypassed approval, or a higher ceiling
- **THEN** neither that evidence nor a classifier response can authorize those changes

#### Scenario: Parent input is required
- **WHEN** the worker has a correlated parent question or a known approval dependency
- **THEN** the runner yields through the existing control flow rather than spending extra turns to work around it

### Requirement: Classifier work is bounded and optional
Checks SHALL occur only near the current allowance boundary, with at most two shared classifier invocations per assignment and one invocation per allowance revision. Each check SHALL have a bounded timeout and cancellation. Failure, uncertainty, or insufficient confidence SHALL retain the current allowance and request wrap-up without application-level retries.

#### Scenario: Repeated checkpoint events
- **WHEN** repeated events or concurrent observations reach the same allowance checkpoint
- **THEN** they share one decision attempt rather than starting duplicate classifier invocations

#### Scenario: Classifier timeout
- **WHEN** a budget check times out with two turns remaining
- **THEN** no turns are granted, wrap-up uses the remaining allowance, and classifier failure alone does not fail the worker

### Requirement: Grants precede further execution at an awaited boundary
An unresolved budget check SHALL prevent the next child model request from starting. A grant SHALL apply at a supported awaited execution boundary, without interrupting or replaying a tool already in flight. Check processing SHALL NOT create additional child turns or release the worker's execution reservation.

#### Scenario: Live grant reaches the driver
- **WHEN** a running assignment's checkpoint grants an increment
- **THEN** the next child turn observes the updated allowance rather than the segment's original budget snapshot

#### Scenario: Check remains unresolved
- **WHEN** a classifier request is pending at the execution boundary
- **THEN** the next child model request does not start and the runner does not admit another worker using that reservation

### Requirement: Stale decisions cannot change budgets
A grant SHALL be revalidated against the owning parent, worker, assignment, execution segment, allowance revision, and current lifecycle before commit. Cancellation, release, teardown, replacement of the assignment, or loss of eligibility SHALL invalidate pending advice. Late responses SHALL NOT restart work or restore permissions.

#### Scenario: Cancellation while checking
- **WHEN** cancellation begins before a positive classifier result arrives
- **THEN** that result is discarded, no grant is committed, and normal confirmed-shutdown rules still govern reservation release

#### Scenario: Parent changes the allowance
- **WHEN** an allowance revision changes while a check for its prior revision is outstanding
- **THEN** the old result cannot grant turns against the new revision

### Requirement: Assignment accounting survives questions and replies
Questions and replies SHALL preserve cumulative turns used, granted allowance, configured ceiling, and consumed grant and check counts. Waiting SHALL add no child turns. Only an explicit continuation SHALL create a new bounded assignment; adaptive policy SHALL NOT create continuations or replacements to evade a limit.

#### Scenario: Repeated questions
- **WHEN** an assignment pauses for multiple parent answers
- **THEN** each resumption uses the remaining allowance and does not replenish automatic-grant or classifier-check capacity

#### Scenario: Explicit follow-up
- **WHEN** the parent explicitly continues an eligible retained worker
- **THEN** the new assignment resolves its initial allowance and any lowered ceiling within the worker's frozen specialist configuration

### Requirement: Handoff remains bounded and truthful
When no grant is available, the runner SHALL use up to the final two remaining turns to request a bounded handoff and stop at the granted allowance. Budget exhaustion SHALL remain incomplete work. Provider or handoff failure SHALL retain available partial evidence rather than trigger a hidden retry or a successful completion claim.

#### Scenario: Handoff does not arrive
- **WHEN** a worker reaches its allowance without a final handoff
- **THEN** its outcome reports budget exhaustion and available partial evidence, not task success

#### Scenario: Very short allowance
- **WHEN** an assignment has fewer than two turns available
- **THEN** wrap-up uses only those available turns without adding a hidden reserve or resetting usage

### Requirement: Classifier inputs exclude sensitive execution evidence
Classifier requests SHALL contain only bounded, non-sensitive task metadata and structural progress signals approved for that purpose. Raw prompts, transcripts, tool bodies, credentials, environment dumps, and private paths SHALL NOT be forwarded automatically. Insufficient safe evidence SHALL produce non-granting advice rather than broader data collection.

#### Scenario: Sensitive data appears in worker evidence
- **WHEN** raw worker evidence contains a secret canary or private path
- **THEN** that content is absent from the classifier request and budget diagnostics

#### Scenario: Progress context is insufficient
- **WHEN** the permitted metadata does not support a confident progress judgment
- **THEN** the runner preserves the current allowance without fetching more evidence or adding a separate summarization-model call

### Requirement: Budget evidence is inspectable without new execution
Detailed inspection SHALL distinguish initial allowance, granted allowance, configured ceiling, advisory versus applied decisions, and available classifier usage. Missing data SHALL be unavailable, not invented. Material grants SHALL use existing notification delivery. Status projections SHALL remain lightweight and inspection SHALL NOT trigger checks.

#### Scenario: Inspect an applied nudge
- **WHEN** an assignment initially granted 16 turns receives a four-turn grant under a ceiling of 24
- **THEN** detailed inspection shows initial 16, granted 20, ceiling 24, and the applied decision without implying verified task completion

#### Scenario: Reported classifier usage is missing
- **WHEN** a provider omits classifier cost or token usage
- **THEN** inspection marks it unavailable rather than reporting zero or claiming a measured saving

### Requirement: Saved histories remain evidence rather than authority
Budget metadata SHALL be additive to saved evidence and preserve stable identifiers and tool-result details. Older histories SHALL remain readable without invented initial allowances or ceilings. Restored records SHALL be read-only and SHALL NOT reconstruct executable workers, pending checks, or grants.

#### Scenario: Inspect an older saved assignment
- **WHEN** a saved assignment has its prior allowance but no adaptive-budget metadata
- **THEN** the known allowance and evidence remain readable, missing adaptive facts are unavailable, and no classifier request is made

#### Scenario: Reload during a check
- **WHEN** Pi reloads with a pending budget check
- **THEN** normal teardown invalidates the check and saved history cannot revive it

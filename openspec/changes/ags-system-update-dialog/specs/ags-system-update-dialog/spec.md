## Purpose

Provide a desktop-native NixOS flake update workflow with explicit lifecycle states, safe recovery guarantees, structured progress, and testable AGS interactions.

## ADDED Requirements

### Requirement: Design-System System Update Surface
The system SHALL define a pure System Update Dialog in `design-system/src/components/SystemUpdateDialog/` as the visual and interaction contract for downstream shell implementations.

#### Scenario: Surface renders supplied state
- **WHEN** the System Update Dialog receives update state through props
- **THEN** it renders the supplied phase, progress, elapsed time, steps, generation metadata, technical details, messages, and actions
- **AND** it does not invoke Nix, Fish, AGS, systemd, or subprocess APIs

#### Scenario: Surface uses design-system primitives
- **WHEN** the System Update Dialog renders buttons, status labels, and the window surface
- **THEN** it uses the existing `Button` and `Window` components where their contracts fit
- **AND** its visual states use design-system tokens and Tailwind utilities

#### Scenario: Footer action hierarchy
- **WHEN** the dialog offers both cancellation and a primary action
- **THEN** Cancel uses the transparent button treatment
- **AND** the primary action remains the rightmost action

#### Scenario: Step status is not duplicated
- **WHEN** an update step renders
- **THEN** its marker communicates pending, active, complete, or failed state
- **AND** the step does not repeat that state in a status badge
- **AND** assistive technology receives the step label and status

#### Scenario: Essential states have Storybook references
- **WHEN** the design-system contract is implemented
- **THEN** Storybook includes idle check, checking, check failure, lockfile update failure, rebuilding, rebuild failure, and successful completion references
- **AND** future build-only activation is labeled as unsupported by the current runtime until a build-then-activate path exists

### Requirement: Structured Update Lifecycle
The update workflow SHALL expose structured state transitions instead of requiring AGS to parse terminal decoration or infer state from free-form command output.

#### Scenario: Idle check state
- **WHEN** the dialog opens without an active update operation
- **THEN** it provides a `Check for updates` action
- **AND** it may show the last successful check time when known

#### Scenario: Active check state
- **WHEN** update discovery is running
- **THEN** the workflow reports a checking phase with indeterminate progress
- **AND** the dialog shows elapsed time without inventing an estimated remaining time

#### Scenario: Flake inputs are being fetched
- **WHEN** the checker or lockfile update is waiting on flake source network requests
- **THEN** the dialog renders a back-and-forth indeterminate progress bar
- **AND** it does not display a percentage

#### Scenario: Updates are available
- **WHEN** one or more flake inputs have newer revisions
- **THEN** the workflow reports each input name, current revision, and candidate revision
- **AND** the user can choose which inputs to update before lockfile mutation

#### Scenario: System is up to date
- **WHEN** a valid update check finds no changed inputs
- **THEN** the dialog reports that all flake inputs are up to date
- **AND** no mutation or rebuild action starts

### Requirement: Cache Handling
The workflow SHALL treat the update cache as an optimization rather than an authoritative or user-managed state.

#### Scenario: Valid cache is reused
- **WHEN** cached update data satisfies schema, freshness, and current-lock-revision checks
- **THEN** the workflow may use the cached update result

#### Scenario: Invalid cache triggers fresh check
- **WHEN** cached update data is missing, stale, malformed, inaccessible, or mismatched with the current `flake.lock`
- **THEN** the workflow starts a fresh update check
- **AND** the dialog does not present the cache condition as an update failure

#### Scenario: Fresh check does not produce valid state
- **WHEN** the checker fails or does not produce valid update data within its allowed time
- **THEN** the dialog reports a check failure
- **AND** it states that the system was not changed
- **AND** it provides a retry action

### Requirement: Confirmed Lockfile Mutation
The workflow SHALL require explicit input selection and confirmation before changing `flake.lock`.

#### Scenario: User confirms selected updates
- **WHEN** the user selects one or more inputs and confirms the update
- **THEN** the workflow creates a backup of the current `flake.lock` before mutation
- **AND** it updates only the selected flake inputs

#### Scenario: User cancels before mutation
- **WHEN** the user closes the picker, selects no inputs, or declines confirmation
- **THEN** the workflow stops without modifying `flake.lock`
- **AND** cancellation is not reported as a failure

#### Scenario: Lockfile update fails
- **WHEN** the selected-input update command fails
- **THEN** the rebuild does not start
- **AND** the dialog marks lockfile update as failed and rebuild as pending
- **AND** the dialog hides the redundant operation progress summary
- **AND** it does not repeat the pending rebuild state in an alert
- **AND** the dialog does not claim that the lockfile was restored unless restoration was verified
- **AND** technical details preserve the command failure output

### Requirement: NixOS Rebuild and Activation
The current runtime workflow SHALL expose rebuild and activation as separate visible phases of one `switch` operation.

#### Scenario: Rebuild and switch start
- **WHEN** lockfile mutation succeeds and the user confirms rebuilding
- **THEN** the workflow runs the existing `nh os switch` path when available
- **AND** it otherwise runs the existing `nixos-rebuild switch` fallback
- **AND** the dialog marks rebuild active and activation pending

#### Scenario: Rebuild progress can be estimated
- **WHEN** the rebuild producer exposes structured completed-work and total-work events
- **THEN** the dialog displays an estimated rebuild percentage
- **AND** labels that percentage as approximate
- **AND** the estimate does not use network transfer progress or command-output line count

#### Scenario: Activation starts
- **WHEN** the built configuration begins activation within the switch operation
- **THEN** the dialog marks rebuild complete and activation active
- **AND** the phase reads `Activating configuration...`
- **AND** progress is indeterminate unless the activation producer exposes meaningful completed-work and total-work data

#### Scenario: Activation fails
- **WHEN** rebuild completes but activation exits unsuccessfully
- **THEN** the dialog marks lockfile update and rebuild complete and activation failed
- **AND** it hides the completed operation progress summary
- **AND** it warns that active system state may be partially updated
- **AND** it offers user-controlled Retry and Cancel actions
- **AND** it does not retry automatically
- **AND** technical details remain available for verification

#### Scenario: Rebuild is skipped
- **WHEN** lockfile mutation succeeds and the user declines rebuilding
- **THEN** the updated lockfile remains in place
- **AND** the dialog reports that rebuilding was skipped and can be run later

#### Scenario: Rebuild and switch succeed
- **WHEN** the switch command exits successfully
- **THEN** the workflow removes the pre-update lockfile backup
- **AND** reports successful completion
- **AND** refreshes update cache state
- **AND** retains the successful outcome if only the post-success cache refresh fails

#### Scenario: Separate activation is unavailable
- **WHEN** the runtime uses a `switch` command
- **THEN** it does not expose `Activate now` as an executable action
- **AND** a separate ready-to-activate state remains disabled until the runner can build without switching

### Requirement: Rebuild Failure Recovery
The workflow SHALL restore the pre-update lockfile when rebuild or switch fails and SHALL report only recovery guarantees it verified.

#### Scenario: Rebuild or switch fails
- **WHEN** the switch command exits unsuccessfully
- **THEN** the workflow restores the pre-update `flake.lock`
- **AND** verifies that restoration completed before claiming success
- **AND** marks the lockfile step complete and rebuild step failed
- **AND** preserves technical output for diagnosis

#### Scenario: Lockfile restoration succeeds
- **WHEN** rebuild or switch fails and the prior lockfile is restored successfully
- **THEN** the dialog states that the previous `flake.lock` was restored
- **AND** it makes no claim about active-generation rollback

#### Scenario: Lockfile restoration fails
- **WHEN** rebuild or switch fails and restoring the prior lockfile also fails
- **THEN** the dialog reports both the original failure and the restoration failure
- **AND** it does not claim that repository state is safe
- **AND** it does not automatically retry mutation or rebuild

### Requirement: Progress and Technical Output
The workflow SHALL provide phase-level progress and bounded technical output without fabricating precise build completion estimates.

#### Scenario: Determinate progress is known
- **WHEN** the producer can calculate meaningful completed work against total work
- **THEN** the dialog renders a determinate progress bar with a percentage
- **AND** the exposed accessible progress value matches the displayed value

#### Scenario: Rebuild progress is estimated
- **WHEN** rebuild completion is inferred from structured Nix work events rather than a complete operation denominator
- **THEN** the displayed percentage is prefixed with `~`
- **AND** the accessible progress value remains the corresponding numeric estimate

#### Scenario: Determinate progress is unknown
- **WHEN** the producer cannot calculate meaningful total work
- **THEN** the dialog renders indeterminate progress
- **AND** it does not invent a percentage or remaining-time estimate

#### Scenario: Elapsed time is available
- **WHEN** an operation is active or has failed after running
- **THEN** the dialog may show monotonic elapsed time
- **AND** the progress bar references that elapsed time as accessible descriptive text

#### Scenario: Phase duration is available
- **WHEN** a phase completes or fails and its duration is known
- **THEN** the corresponding step displays that duration as secondary metadata
- **AND** active and pending steps do not duplicate the overall elapsed time

#### Scenario: Technical output is available
- **WHEN** commands emit diagnostic output
- **THEN** the dialog makes bounded recent output available through a disclosure
- **AND** current generation metadata remains in the header, separate from that disclosure
- **AND** full output remains available through a durable log or runner result when the bounded view truncates it

### Requirement: AGS System Update Dialog
The system SHALL implement the update workflow as an AGS dialog that mirrors the design-system contract without importing React or Storybook code.

#### Scenario: Bundled component registration
- **WHEN** `ags-bundled` starts
- **THEN** the System Update Dialog initializes and registers through the existing bundled component registry
- **AND** update backend initialization failure does not prevent other bundled components from loading

#### Scenario: Dialog request API
- **WHEN** AGS receives System Update Dialog requests
- **THEN** it supports `show`, `hide`, `toggle`, `check`, and `is-visible` actions
- **AND** malformed requests return a structured error without throwing

#### Scenario: Duplicate launch request
- **WHEN** an update dialog or update operation is already active
- **THEN** another show or check request focuses or reveals the existing dialog
- **AND** it does not start a concurrent update operation

#### Scenario: Dialog dismissal
- **WHEN** no mutating operation is active
- **THEN** the user can close the dialog with its close action or Escape

#### Scenario: Active mutation cannot be silently abandoned
- **WHEN** lockfile mutation or rebuild/switch is active
- **THEN** closing the visible dialog does not terminate or orphan the operation without an explicit cancellation contract
- **AND** reopening the dialog restores the current operation state

### Requirement: Start Menu Integration
The system SHALL open the AGS System Update Dialog from the existing Start Menu system-update action.

#### Scenario: System Updates action opens dialog
- **WHEN** the user activates System Updates from the Start Menu
- **THEN** the Start Menu opens or focuses the AGS System Update Dialog
- **AND** it no longer requires a dedicated terminal window for the primary workflow

#### Scenario: Badge refresh follows terminal outcome
- **WHEN** an update check or update workflow reaches a terminal outcome
- **THEN** the Start Menu update badge refreshes from validated cache state
- **AND** cache-refresh failure does not rewrite a successful update outcome as failure

### Requirement: System Update Validation
The system SHALL provide focused validation for update state transitions, recovery behavior, and shell integration.

#### Scenario: Design-system validation
- **WHEN** System Update Dialog component or story files change
- **THEN** targeted formatting and lint checks pass
- **AND** Storybook builds with all essential update stories

#### Scenario: Runner state-transition validation
- **WHEN** the structured update runner is implemented
- **THEN** tests cover up-to-date, updates-available, check failure, cancellation before mutation, lockfile failure, successful switch, failed switch with successful restoration, and failed restoration outcomes
- **AND** tests do not require mutating the live system profile or repository lockfile

#### Scenario: AGS integration validation
- **WHEN** the AGS dialog is implemented
- **THEN** request API checks cover visibility, duplicate operation prevention, malformed requests, and terminal-state rendering
- **AND** `ags-bundled` remains available when the update backend fails to initialize

## Purpose

Provide a desktop-native NixOS flake update workflow with lock-aware cached discovery, isolated candidate mutation, automatic unprivileged build, explicitly authenticated exact-build activation, durable lifecycle state, and verified recovery.

## ADDED Requirements

### Requirement: Design-System System Update Surface
The system SHALL define a pure System Update Dialog in `design-system/src/components/SystemUpdateDialog/` as the visual and interaction contract for downstream shell implementations.

#### Scenario: Surface renders supplied lifecycle state
- **WHEN** the System Update Dialog receives a valid update lifecycle state
- **THEN** it renders only the phases, progress, elapsed time, steps, generation metadata, technical details, messages, and actions permitted by that state
- **AND** it does not invoke Nix, Fish, AGS, systemd, or subprocess APIs

#### Scenario: Surface uses design-system primitives
- **WHEN** the System Update Dialog renders controls, progress, and its window surface
- **THEN** it uses the existing `Button`, `ProgressBar`, and `Window` components where their contracts fit
- **AND** its visual states use design-system tokens and Tailwind utilities

#### Scenario: Invalid lifecycle actions are excluded
- **WHEN** lockfile update or build is active
- **THEN** the state model permits Hide but not Cancel
- **AND** when activation has started it permits neither Hide, Close, nor Cancel
- **AND** `Activate now` is available only for a retained successful build

#### Scenario: Step status is not duplicated
- **WHEN** an update step renders
- **THEN** its marker communicates pending, active, complete, or failed state
- **AND** the step does not repeat that state in a visible status badge
- **AND** assistive technology receives the step label and status

#### Scenario: Essential states have Storybook references
- **WHEN** the design-system contract is implemented
- **THEN** Storybook includes checking, matching cached results, stale refresh warning, no updates, check failure, empty selection, candidate update, build, Ready to activate, authentication error, activation, successful completion, cancelled check, build failure, activation failure, interrupted operation, and unsafe restoration failure references
- **AND** interactions cover state-specific actions and dismissal behavior

### Requirement: Versioned Update Runner Contract
The update workflow SHALL expose versioned structured commands, state, results, caches, and machine-readable errors instead of requiring clients to infer lifecycle from command output.

#### Scenario: Runner state is published
- **WHEN** an operation changes state
- **THEN** the runner atomically publishes its schema version, operation identity, lifecycle phase, step states, monotonic elapsed time, selected and resolved inputs, bounded recent output, optional result link, generation metadata, warnings, and recovery outcome
- **AND** AGS does not parse decorated command output to derive lifecycle state

#### Scenario: Unknown or malformed input reaches a boundary
- **WHEN** a command, state file, cache, or result has an unknown schema version or malformed content
- **THEN** the consumer rejects it with a structured error
- **AND** no lockfile or system-profile mutation starts

#### Scenario: Runner command is submitted
- **WHEN** a client submits check, cancel-check, update/build, activate, discard-pending, retry, or automatic-check timer change
- **THEN** the discriminated command includes its expected operation identity and state revision when acting on an existing operation
- **AND** the runner accepts it only from the command's declared source lifecycle states
- **AND** stale, invalid, or replayed commands cannot act on a newer state

#### Scenario: Unsupported transactional state is found
- **WHEN** a runner encounters unknown-version state that may contain mutation, pending activation, backup, or recovery evidence
- **THEN** it preserves the state and referenced artifacts
- **AND** enters a non-destructive compatibility block
- **AND** does not treat that state as disposable cache data

#### Scenario: Runner survives the UI lifecycle
- **WHEN** AGS reloads or the update dialog closes during checking, lockfile update, or build
- **THEN** a user-systemd service continues to own the operation
- **AND** AGS reconnects from the atomic durable state file using filesystem events
- **AND** it does not poll when filesystem event notification is available

#### Scenario: Duplicate operation is requested
- **WHEN** an operation already owns the update lock
- **THEN** the runner does not start a second transaction
- **AND** the client receives or reveals the current operation identity

### Requirement: Authoritative Flake Target
The workflow SHALL use `NH_OS_FLAKE` as the single authoritative flake target for checking, candidate mutation, backup, and build.

#### Scenario: Flake target is available
- **WHEN** a check, update, or build starts
- **THEN** the runner resolves the target from the user service's declared `NH_OS_FLAKE`
- **AND** checking, candidate generation, backup, and `nh` build use that same resolved target

#### Scenario: Flake target is unavailable
- **WHEN** `NH_OS_FLAKE` is missing, cannot be resolved, or does not contain `flake.lock`
- **THEN** the workflow reports a precondition failure
- **AND** it does not fall back to `~/nixos` or another implicit path
- **AND** it does not start mutation or build

### Requirement: Lock-Aware Update Cache
The workflow SHALL publish and consume a versioned Nix update cache bound to the complete source `flake.lock`.

#### Scenario: Checker publishes a valid Nix result
- **WHEN** every required flake input check succeeds
- **THEN** the checker atomically publishes a cache containing the schema version, complete source-lock fingerprint, timestamp, and update list
- **AND** each update contains its input name, current revision, and candidate revision
- **AND** the cache identifies directly checked inputs, followed inputs covered by those checks, and intentionally non-updateable inputs

#### Scenario: Checker classifies root inputs
- **WHEN** the checker reads root flake inputs
- **THEN** it classifies each as directly checkable with a revision-bearing upstream, covered by a followed target, or intentionally non-updateable
- **AND** an input that cannot be classified causes whole-check failure

#### Scenario: One or more Nix input checks fail
- **WHEN** any required input check errors or exceeds its allowed time
- **THEN** the whole Nix check fails
- **AND** no candidate Nix cache is published
- **AND** incomplete results are not presented as `No updates available`

#### Scenario: Existing unversioned cache is found
- **WHEN** the consumer reads cache data without the current schema version and complete lock fingerprint
- **THEN** it treats that cache as invalid disposable state
- **AND** it does not use a compatibility reader

#### Scenario: Matching cache is available on dialog open
- **WHEN** a schema-valid cache fingerprint exactly matches the current `flake.lock`
- **THEN** the dialog shows the cached result immediately
- **AND** cache age affects only its stale label and automatic refresh behavior
- **AND** the cached result remains selectable regardless of age while the exact fingerprint matches

#### Scenario: No matching cache is available on dialog open
- **WHEN** cache data is absent, malformed, inaccessible, or bound to another lock fingerprint
- **THEN** opening the dialog starts a manual check automatically
- **AND** the cache condition is not presented as an update failure

#### Scenario: Stale cache is shown
- **WHEN** a matching cache is stale
- **THEN** the dialog keeps its updates or no-update result visible
- **AND** it starts a background refresh automatically
- **AND** it shows a subtle refreshing state instead of replacing the result with a loading-only screen

#### Scenario: Refresh changes available inputs
- **WHEN** a fresh check returns while the user has edited selection
- **THEN** choices for inputs still present are preserved
- **AND** newly discovered inputs are selected by default
- **AND** inputs no longer present are removed

#### Scenario: Refresh fails with a matching cache
- **WHEN** a fresh check fails and the previous cache still matches the current lock fingerprint
- **THEN** the cached view remains visible and usable
- **AND** the dialog shows a compact refresh warning
- **AND** applying those matching cached results requires no extra stale-data confirmation

#### Scenario: Refresh fails without a matching cache
- **WHEN** a fresh check fails and no matching cache exists
- **THEN** the dialog reports check failure
- **AND** states that the system was not changed
- **AND** provides Retry and Close actions

#### Scenario: Flatpak refresh fails
- **WHEN** the checker's independent Flatpak cache refresh fails after a valid Nix result exists
- **THEN** the valid Nix cache is still published
- **AND** the Nix-only dialog does not classify the check as failed

### Requirement: Check Ownership and Cancellation
The workflow SHALL coordinate scheduled and manual checks through the same operation lock while allowing explicit manual checks to take priority.

#### Scenario: Manual check starts while scheduled service runs
- **WHEN** the user requests a manual check and `flake-update-checker.service` is active
- **THEN** the runner stops that user service through systemd
- **AND** starts a runner-owned check after acquiring the shared lock

#### Scenario: User cancels a manual check
- **WHEN** the user activates Cancel while a runner-owned check is active
- **THEN** the runner terminates the owned checker process group
- **AND** does not publish partial candidate results
- **AND** preserves the last fully validated cache
- **AND** reports cancellation without classifying it as failure

#### Scenario: Scheduled check collides with a transaction
- **WHEN** the timer starts a check while lockfile update, build, pending activation, or activation owns the operation lock
- **THEN** the scheduled checker exits successfully without changing Nix or Flatpak caches

#### Scenario: Update is requested during background refresh
- **WHEN** the user confirms selected updates while a background refresh is active
- **THEN** the runner cancels that refresh
- **AND** proceeds only if the displayed cache fingerprint still exactly matches the current lockfile

#### Scenario: Lockfile changed before update starts
- **WHEN** the displayed cache fingerprint no longer matches the current lockfile
- **THEN** the runner does not generate or publish a candidate update
- **AND** it starts a fresh check automatically

### Requirement: Automatic Check Timer Control
The dialog SHALL reflect and control the existing `flake-update-checker.timer` without duplicating its schedule policy.

#### Scenario: User enables automatic checks
- **WHEN** the user enables Automatically check for updates
- **THEN** the workflow enables and starts the user timer
- **AND** the existing timer configuration remains authoritative for frequency

#### Scenario: User disables automatic checks
- **WHEN** the user disables Automatically check for updates
- **THEN** the workflow stops and disables future scheduled checks
- **AND** manual Check again remains available

#### Scenario: Timer state change fails
- **WHEN** enabling or disabling the timer fails
- **THEN** the checkbox reverts to the actual timer state
- **AND** the dialog reports the systemd error in Technical details

### Requirement: Update Selection and Confirmation
The workflow SHALL require an explicit non-empty selected-input scope before candidate generation.

#### Scenario: Updates are available
- **WHEN** one or more flake inputs have newer revisions
- **THEN** the dialog lists each input name and short current-to-candidate revision transition
- **AND** all inputs and Select all are selected by default
- **AND** the user can select or deselect individual inputs
- **AND** Select all exposes selected, unselected, or mixed state accessibly
- **AND** the dialog shows the selected count

#### Scenario: Selection is empty
- **WHEN** no input is selected
- **THEN** `Update selected inputs` is disabled
- **AND** the runner independently rejects an empty selected-input command without mutation

#### Scenario: User starts selected update
- **WHEN** the user activates `Update N selected inputs`
- **THEN** that explicit labeled action is the mutation confirmation
- **AND** the workflow does not show a redundant second confirmation dialog

### Requirement: Candidate Lockfile Publication
The workflow SHALL resolve selected updates into an isolated candidate and SHALL atomically replace the real lockfile only after complete candidate validation.

#### Scenario: Candidate generation starts
- **WHEN** a confirmed selected-input transaction starts against a matching lock fingerprint
- **THEN** the runner requires `flake.lock` to be a regular non-symlink file
- **AND** saves the exact pre-transaction file as a durable backup
- **AND** fsyncs the backup and its parent directory before mutation
- **AND** creates the candidate on the same filesystem as the target lockfile
- **AND** invokes one selected-input update using the real file as `--reference-lock-file` and the candidate as `--output-lock-file`
- **AND** the command does not write the real `flake.lock`

#### Scenario: Candidate generation succeeds
- **WHEN** the selected-input command succeeds and the complete candidate validates
- **THEN** the runner reports the actual resolved revisions
- **AND** those revisions may be newer than the cache values for the same confirmed input names
- **AND** durably records replacement intent, backup identity, and candidate fingerprint before replacing the real file
- **AND** it atomically replaces the real `flake.lock` with the candidate
- **AND** fsyncs the target directory before recording replacement completion
- **AND** starts the build automatically without another confirmation

#### Scenario: Candidate matches the original lockfile
- **WHEN** candidate validation succeeds but the candidate is byte-identical to the original lockfile
- **THEN** the runner still starts the requested build

#### Scenario: Candidate generation fails
- **WHEN** selected-input resolution or candidate validation fails
- **THEN** the runner discards the candidate
- **AND** verifies that the real `flake.lock` remains unchanged
- **AND** does not start the build
- **AND** preserves complete diagnostic output

#### Scenario: Real lockfile changed during failed candidate generation
- **WHEN** candidate generation fails and the real lockfile no longer matches the saved original
- **THEN** the runner treats the mismatch as an external-change recovery conflict
- **AND** does not overwrite the changed lockfile
- **AND** preserves the saved backup and blocks mutation pending repair

### Requirement: Automatic Unprivileged Build
The workflow SHALL build the selected update automatically with `nh` after atomic lockfile publication and SHALL not activate during that build.

#### Scenario: Build starts
- **WHEN** candidate publication succeeds
- **THEN** the runner executes `nh os build --out-link <operation-owned-result>`
- **AND** `nh` uses the service's `NH_OS_FLAKE` and host resolution
- **AND** the runner does not fall back to `nixos-rebuild build` when `nh` is unavailable

#### Scenario: Build is active
- **WHEN** `nh os build` is running
- **THEN** the dialog marks build active and activation pending
- **AND** progress is indeterminate
- **AND** it does not parse decorated `nh` or nix-output-monitor output into a percentage
- **AND** closing the dialog hides it while the runner continues

#### Scenario: Build fails
- **WHEN** the build exits unsuccessfully
- **THEN** the runner applies the final published-candidate fingerprint guard
- **AND** when the guard matches it restores and byte-verifies the pre-transaction `flake.lock`
- **AND** when the guard does not match it enters external-change recovery conflict without overwriting the file
- **AND** removes any pending result link
- **AND** the dialog marks build failed and reports verified restoration
- **AND** Retry repeats the full transaction after revalidation
- **AND** no retry starts automatically

### Requirement: Durable Ready to Activate State
The workflow SHALL preserve a successful build as an explicit durable checkpoint until activation or discard.

#### Scenario: Build succeeds
- **WHEN** `nh os build` completes with a valid operation-owned result link
- **THEN** the runner resolves and validates one canonical `/nix/store/...` NixOS system closure
- **AND** persists that immutable path while retaining the result link only as a garbage-collection root
- **AND** the dialog enters Ready to activate
- **AND** shows both the current active generation and pending NixOS version/build time
- **AND** keeps the full immutable store path in Technical details
- **AND** offers `Activate now` and `Activate later`

#### Scenario: User chooses Activate later
- **WHEN** the user activates `Activate later`, closes the dialog, presses Escape, logs out, reboots, or AGS reloads before activation
- **THEN** the updated lockfile, backup, result link, and Ready to activate state remain durable
- **AND** reopening the dialog restores that state

#### Scenario: Source configuration changes after build
- **WHEN** `flake.lock` or another source file changes after build success
- **THEN** Ready to activate still refers to the exact immutable retained closure
- **AND** activation does not reevaluate or rebuild the changed source

#### Scenario: User starts another update with a pending build
- **WHEN** a Ready to activate operation exists and the user requests another transaction
- **THEN** the dialog requires explicit pending-build discard first
- **AND** it does not silently replace the retained result

#### Scenario: User discards pending build
- **WHEN** the user confirms pending-build discard
- **THEN** the runner removes the operation result link
- **AND** removes the transaction backup
- **AND** keeps the updated `flake.lock`
- **AND** clears the pending operation

### Requirement: Graphically Authenticated Exact-Build Activation
The workflow SHALL activate only the exact retained closure after explicit user confirmation, with credentials owned by polkit.

#### Scenario: Graphical authentication is configured
- **WHEN** the desktop session starts
- **THEN** the NixOS/Hyprland configuration autostarts `hyprpolkitagent`
- **AND** AGS, Fish, Bun, and the runner do not read, receive, log, or pipe the user's password

#### Scenario: User confirms activation
- **WHEN** the user activates `Activate now`
- **THEN** the runner verifies that the result link still resolves to the persisted valid canonical closure
- **AND** invokes `nixos-rebuild switch --store-path <canonical-store-path> --elevate=run0`
- **AND** activation uses the exact retained closure without reevaluation or rebuild
- **AND** successful activation makes that closure the current and boot-default generation

#### Scenario: Authentication is cancelled or denied
- **WHEN** the user dismisses the polkit prompt, denies authorization, or enters invalid credentials before activation starts
- **THEN** the operation remains Ready to activate
- **AND** the dialog reports the authentication error
- **AND** it does not restore the lockfile or discard the retained build

#### Scenario: Activation command cannot start
- **WHEN** `nixos-rebuild`, run0, polkit, or the graphical agent is unavailable before activation begins
- **THEN** the operation remains Ready to activate
- **AND** it reports the launch or authentication precondition error
- **AND** it does not fall back to sudo, askpass, direct switch scripts, or another privileged command

#### Scenario: Activation has started
- **WHEN** the activation adapter durably records its authoritative started marker before privileged profile registration or configuration activation
- **THEN** the dialog marks build complete and activation active
- **AND** shows indeterminate progress
- **AND** disables Escape and the title-bar close control until a terminal result
- **AND** does not expose cancellation

#### Scenario: Activation start cannot be classified
- **WHEN** activation fails or is interrupted without trustworthy evidence that it occurred before or after the authoritative started marker
- **THEN** the runner does not guess between authentication failure and partial activation
- **AND** preserves the backup, result, state, and log
- **AND** enters a blocking indeterminate-recovery state

#### Scenario: Activation succeeds
- **WHEN** exact-store switch exits successfully
- **THEN** the runner removes the pre-transaction backup and pending result link
- **AND** publishes successful completion with the new boot-default generation
- **AND** the completion view shows new generation number/date, completed phases, Technical details, and Close
- **AND** it offers no reboot or rollback action

### Requirement: Verified Failure Recovery
The workflow SHALL restore the exact pre-transaction lockfile after build or started-activation failure and SHALL report only recovery outcomes it verifies.

#### Scenario: Activation fails after starting
- **WHEN** exact-store activation exits unsuccessfully after privileged activation began
- **THEN** the runner applies the final published-candidate fingerprint guard
- **AND** when the guard matches it restores and byte-verifies the pre-transaction `flake.lock`
- **AND** when the guard does not match it enters external-change recovery conflict without overwriting the file
- **AND** removes the pending result link
- **AND** warns that running services or active system state may be partially changed
- **AND** does not claim active-generation rollback
- **AND** does not attempt automatic generation rollback

#### Scenario: Restoration succeeds
- **WHEN** a failed update, build, or started activation is followed by successful byte-verified restoration
- **THEN** the dialog states that the exact prior `flake.lock` was restored
- **AND** offers Retry and Close
- **AND** Retry repeats the full selected-input update, build, and activation transaction after cache/lock revalidation

#### Scenario: Restoration fails
- **WHEN** restoring or verifying the saved lockfile fails
- **THEN** the runner preserves the backup and complete log
- **AND** reports both the original failure and restoration failure
- **AND** marks repository state unsafe
- **AND** blocks Retry and every new mutating transaction
- **AND** persists that state across dialog closes, AGS reloads, logout, reboot, and runner restart

#### Scenario: External lockfile change prevents safe restoration
- **WHEN** the final guarded comparison before restoration finds that the current lockfile no longer matches the exact candidate published by the transaction
- **THEN** the runner does not overwrite the external change
- **AND** preserves the pre-transaction backup and complete log
- **AND** reports a recovery conflict
- **AND** blocks Retry and every new mutating transaction under the unsafe recovery rules

#### Scenario: Non-cooperating writer races restoration
- **WHEN** a process that does not use the shared operation lock changes `flake.lock` concurrently with recovery
- **THEN** the runner protects changes visible at its final guarded comparison
- **AND** does not claim a content-based atomic compare-and-swap guarantee against an unseen concurrent rename

#### Scenario: Unsafe state is repaired
- **WHEN** the current `flake.lock` byte-for-byte matches the retained backup
- **THEN** the runner clears the unsafe mutation block
- **AND** removes recovery state only after recording verified repair

### Requirement: Interrupted Operation Recovery
The workflow SHALL distinguish incomplete transactions from durable Ready to activate checkpoints after service or session interruption.

#### Scenario: Session ends during check, candidate update, or build
- **WHEN** logout, reboot, or service termination interrupts active work
- **THEN** the workflow does not inhibit shutdown
- **AND** the next service start verifies no prior child process remains and the current lockfile parses before starting over

#### Scenario: Interruption occurred after lockfile replacement
- **WHEN** the saved operation shows lockfile replacement but not build success
- **THEN** startup verifies the current file still matches the published candidate before restoration
- **AND** restores and byte-verifies the saved pre-transaction lockfile automatically only when that guard succeeds
- **AND** preserves a mismatching external change under blocking recovery conflict
- **AND** returns to normal state only after verified restoration

#### Scenario: Interruption occurred during authentication
- **WHEN** durable state proves authentication had not crossed the activation-start marker
- **THEN** startup returns the retained closure to Ready to activate

#### Scenario: Interruption occurred after activation started
- **WHEN** durable state proves activation crossed the authoritative started marker
- **THEN** startup applies activation-failure recovery
- **AND** preserves the warning that live system state may be partially changed
- **AND** does not attempt generation rollback

#### Scenario: Interruption occurred during restoration
- **WHEN** durable state records restoration intent without verified completion
- **THEN** startup keeps the backup
- **AND** determines whether the current file matches the published candidate, the backup, or neither
- **AND** resumes restoration, records verified completion, or enters recovery conflict accordingly

#### Scenario: Incomplete state is safe to discard
- **WHEN** no prior process remains, the current lockfile is valid, and no unverified replacement requires restoration
- **THEN** startup discards the incomplete operation and returns to normal without prompting

#### Scenario: Interruption cannot be classified safely
- **WHEN** a prior process may remain, the lockfile is invalid, or required restoration cannot be verified
- **THEN** the workflow reports a blocking interrupted or unsafe recovery state
- **AND** does not silently start another operation

#### Scenario: Ready to activate survives interruption
- **WHEN** the prior state records a completed valid result link
- **THEN** startup preserves Ready to activate instead of treating it as incomplete work

### Requirement: Progress and Complete Technical Output
The workflow SHALL provide truthful phase-level progress, bounded visible output, and one retained complete transaction log.

#### Scenario: Meaningful determinate progress exists
- **WHEN** a producer exposes a stable completed-work and total-work denominator
- **THEN** the dialog may render determinate progress
- **AND** its accessible value matches the displayed value

#### Scenario: Meaningful total work is unknown
- **WHEN** checking, candidate fetching, build, or activation lacks a stable denominator
- **THEN** the dialog renders indeterminate progress
- **AND** does not invent a percentage or remaining-time estimate

#### Scenario: Elapsed time and phase duration are available
- **WHEN** an operation is active or a phase has ended
- **THEN** the dialog may show monotonic elapsed time and completed phase durations
- **AND** progress references the elapsed time through accessible descriptive text

#### Scenario: Technical output is available
- **WHEN** any transaction phase emits diagnostic output
- **THEN** the state includes only bounded recent output for rendering
- **AND** a user-only log contains the complete transaction across check, candidate update, build, authentication, activation, and restoration
- **AND** control sequences are neutralized for display
- **AND** AGS renders the content as text rather than markup

#### Scenario: Operation output reaches its safety ceiling
- **WHEN** a command would exceed the configured complete-log ceiling
- **THEN** the runner terminates that command and records a resource-limit failure
- **AND** retains complete output through termination without silently truncating it
- **AND** applies normal restoration rules when mutation already occurred

#### Scenario: Log or state persistence fails
- **WHEN** a required log or state write fails before mutation
- **THEN** the workflow stops without mutation
- **AND** when persistence fails after mutation it stops the active child and recovers from the already-durable journal and backup

#### Scenario: Technical details disclosure renders
- **WHEN** the dialog is not in failure or unsafe recovery
- **THEN** Technical details is collapsed by default
- **AND** when a phase fails or recovery is unsafe it opens by default
- **AND** `Copy output` floats in the top-right of the expanded output box
- **AND** it copies the complete transaction output without toggling the disclosure

#### Scenario: Terminal state is acknowledged
- **WHEN** the user closes activation success or a safely restored failure
- **THEN** the dialog clears that operation state and returns to normal on next open
- **AND** retains only the latest operation log until the next transaction replaces it

### Requirement: Current and Pending Generation Metadata
The dialog SHALL treat generation metadata as informative and SHALL not block update operations when metadata lookup fails.

#### Scenario: Current generation is requested
- **WHEN** the dialog opens or activation succeeds
- **THEN** the workflow reads structured generation data from `nixos-rebuild list-generations --json`
- **AND** shows the current or newly activated generation number and date when available

#### Scenario: Generation lookup fails
- **WHEN** structured generation data cannot be loaded
- **THEN** the dialog displays Unknown generation
- **AND** checking, update, build, and activation remain available according to their normal state

### Requirement: AGS System Update Dialog
The system SHALL implement the workflow as an accessible AGS dialog that mirrors the design-system contract without importing React or Storybook code.

#### Scenario: Bundled component registration
- **WHEN** `ags-bundled` starts
- **THEN** the System Update Dialog initializes through the existing bundled component registry
- **AND** backend initialization failure does not prevent other bundled components from loading

#### Scenario: Dialog request API
- **WHEN** AGS receives System Update Dialog requests
- **THEN** it supports `show`, `hide`, `toggle`, `check`, and `is-visible`
- **AND** malformed requests return a structured error without throwing

#### Scenario: Dialog opens without an active operation
- **WHEN** a valid matching cache exists
- **THEN** the dialog shows that cache immediately
- **AND** when no matching cache exists it starts checking automatically

#### Scenario: Dialog opens with an existing operation
- **WHEN** update, build, Ready to activate, activation, failure, or unsafe recovery state exists
- **THEN** the dialog reconnects to and renders that operation
- **AND** it does not start duplicate work

#### Scenario: Dialog closes during checking
- **WHEN** the user closes or presses Escape during a manual check
- **THEN** the runner cancels the check before dismissal
- **AND** preserves the prior validated cache

#### Scenario: Dialog closes during update or build
- **WHEN** candidate update or build is active
- **THEN** Close or Escape hides the dialog without cancelling the operation
- **AND** reopening reconnects to current state

#### Scenario: Dialog is authenticating but activation has not started
- **WHEN** the update dialog closes while the polkit prompt is open
- **THEN** authentication is cancelled or dismissed
- **AND** the operation remains Ready to activate

#### Scenario: Dialog is activating
- **WHEN** privileged activation has started
- **THEN** Escape and the title-bar close action are disabled
- **AND** focus remains within the dialog until activation succeeds or fails

#### Scenario: Dialog focus lifecycle
- **WHEN** the modal opens
- **THEN** focus moves to an appropriate initial control and remains within the modal
- **AND** closing restores focus to the opener
- **AND** a closed dialog is absent from keyboard navigation

#### Scenario: No updates are available
- **WHEN** a valid result contains no changed Nix inputs
- **THEN** the dialog shows a compact positive `No updates available` result and check time
- **AND** keeps that result visible until dismissed
- **AND** does not auto-close

### Requirement: Start Menu and Notification Integration
The system SHALL open and reflect the Nix-only update workflow through the existing Start Menu action.

#### Scenario: Normal Start Menu state
- **WHEN** no operation, pending activation, or unacknowledged failure exists
- **THEN** the Start Menu shows validated Nix cache state
- **AND** does not combine Flatpak counts into this dialog entry

#### Scenario: Operation is active
- **WHEN** checking, selected-input update, build, or activation is active
- **THEN** the Start Menu entry shows the current phase
- **AND** selecting it focuses the existing dialog

#### Scenario: Build is ready to activate
- **WHEN** a pending exact build exists
- **THEN** the Start Menu entry shows Ready to activate instead of the normal update count
- **AND** selecting it opens that pending operation

#### Scenario: Hidden recoverable failure exists
- **WHEN** a transaction fails while the dialog is hidden and restoration succeeds
- **THEN** the Start Menu shows Update failed until the user opens or dismisses that result
- **AND** then returns to validated cache state

#### Scenario: Hidden terminal state is published
- **WHEN** Ready to activate, recoverable failure, unsafe recovery, or activation success occurs while the dialog is hidden
- **THEN** the desktop sends a notification
- **AND** it suppresses duplicate notification while the dialog is visible

#### Scenario: Activation succeeds
- **WHEN** the new generation is successfully activated
- **THEN** the primary success result is published immediately
- **AND** the runner requests one asynchronous checker refresh
- **AND** refresh failure produces only a secondary warning
- **AND** it does not rewrite activation success as failure

### Requirement: Fish Client Migration
The terminal update entry point SHALL consume the shared runner while converging on the same authoritative flake and transaction semantics as AGS.

#### Scenario: Fish update command selects a target
- **WHEN** `flake_update_interactive` starts
- **THEN** it uses `NH_OS_FLAKE` as its target
- **AND** rejects a positional target that resolves elsewhere
- **AND** does not fall back to `~/nixos`

#### Scenario: Existing flags are used during migration
- **WHEN** terminal users pass `--force` or `--notify`
- **THEN** the migrated client preserves their refresh and notification behavior
- **AND** during one terminal-fallback migration cycle `--rebuild` and `--cache` are accepted as deprecated no-ops because building is automatic and matching cache age is non-authoritative
- **AND** those no-op flags are removed when the terminal desktop fallback is retired

#### Scenario: Fish renders runner state
- **WHEN** the shared runner publishes lifecycle or terminal state
- **THEN** Fish owns terminal selection, confirmation, and rendering
- **AND** maps structured outcomes without parsing decorated command output

### Requirement: System Update Validation
The system SHALL provide focused validation for state transitions, cache integrity, lockfile publication, exact-build activation, recovery, and shell integration.

#### Scenario: Design-system validation
- **WHEN** System Update Dialog component or story files change
- **THEN** targeted formatting and lint checks pass
- **AND** Storybook builds with all required lifecycle references
- **AND** interactions cover state actions, dismissal, focus, disclosure, and selection accessibility

#### Scenario: Cache and checker validation
- **WHEN** the checker or cache contract changes
- **THEN** tests cover version invalidation, complete fingerprints, all-or-nothing checking, atomic publication, cancellation retention, stale matching cache, Flatpak independence, and scheduled/manual collisions

#### Scenario: Candidate transaction validation
- **WHEN** selected-input mutation is implemented
- **THEN** tests use temporary same-filesystem lockfiles
- **AND** cover empty selection, external lock changes, candidate isolation, validation, atomic replacement, changed resolved revisions, identical candidates, and candidate failure
- **AND** do not mutate the repository's real `flake.lock`

#### Scenario: Build and activation validation
- **WHEN** build and activation are implemented
- **THEN** fake adapters cover build failure restoration, pending persistence and discard, authentication cancellation, activation launch failure, exact-store success, started-activation failure, and partial-state warnings
- **AND** tests do not mutate the live system profile

#### Scenario: Recovery validation
- **WHEN** interruption and restoration behavior is implemented
- **THEN** tests cover interruption before backup, after replacement, during build, at Ready to activate, during activation, and during restoration
- **AND** cover successful byte-verification, unsafe blocking, and repair matching

#### Scenario: AGS integration validation
- **WHEN** the AGS dialog is implemented
- **THEN** request checks cover visibility, malformed input, duplicate prevention, filesystem-event reconnection, lifecycle-specific dismissal, focus behavior, timer rollback, notifications, bounded output, and backend unavailability
- **AND** `ags-bundled` remains available when the update backend fails to initialize

## Purpose

Define one reliable profile-control boundary for manual and automatic desktop performance modes, so UI and runtime consumers observe consistent policy and recovery state.

## ADDED Requirements

### Requirement: Explicit manual selection
The profile control plane SHALL persist one manual selection of `auto`, `default`, `gaming`, or `powersave`. A manual Default, Gaming, or Powersave selection SHALL determine the resolved profile independently of automatic source claims.

#### Scenario: Manual Default overrides automatic Gaming
- **WHEN** an automatic Gaming source is active and the user selects manual Default
- **THEN** the resolved and applied profile becomes Default after successful convergence
- **AND** the automatic Gaming source claim remains recorded

#### Scenario: Manual Power Saver overrides automatic Gaming
- **WHEN** an automatic Gaming source is active and the user selects manual Power Saver
- **THEN** the resolved and applied profile becomes Powersave after successful convergence
- **AND** the automatic Gaming source claim remains recorded

#### Scenario: Clearing manual selection restores automatic policy
- **WHEN** manual Default, Gaming, or Power Saver is selected while an automatic Gaming source is active
- **AND** the user clears the manual selection
- **THEN** the manual selection becomes Auto
- **AND** Gaming resolves immediately without waiting for a new source event

#### Scenario: Manual Gaming remains active after automatic Gaming ends
- **WHEN** manual Gaming is selected and an automatic Gaming source becomes inactive
- **THEN** Gaming remains the resolved profile until the manual selection changes

### Requirement: Automatic source resolution
The profile control plane SHALL retain bounded, named automatic source claims for Gaming and Powersave. While manual selection is Auto, it SHALL resolve Gaming when any Gaming claim is active, Powersave when no Gaming claim and at least one Powersave claim is active, and Default when no claim is active.

#### Scenario: Multiple automatic Gaming sources
- **WHEN** more than one automatic Gaming source is active
- **THEN** Gaming remains resolved until every Gaming source claim is inactive

#### Scenario: Automatic Powersave without Gaming
- **WHEN** manual selection is Auto, no Gaming source is active, and a Powersave source is active
- **THEN** Powersave is resolved

#### Scenario: Automatic Gaming takes precedence in Auto
- **WHEN** manual selection is Auto and both Gaming and Powersave sources are active
- **THEN** Gaming is resolved

### Requirement: Canonical profile state publication
The profile control plane SHALL publish one versioned profile-state snapshot that includes manual selection, automatic source claims, resolved profile, last known applied profile, transition phase, and a monotonically increasing generation. Consumers SHALL observe either the complete previous snapshot or the complete next snapshot.

#### Scenario: Successful state transition
- **WHEN** a requested profile transition converges
- **THEN** the published snapshot identifies the requested manual selection, resolved profile, applied profile, and a converged phase
- **AND** its generation is newer than the prior published snapshot

#### Scenario: Reader observes a state replacement
- **WHEN** a consumer reads profile state during publication
- **THEN** it observes a complete valid snapshot from one generation
- **AND** it does not observe a partially written document or mixed generation

#### Scenario: Unknown state version
- **WHEN** a profile-state reader encounters a newer unsupported version
- **THEN** it SHALL not replace that state with a default profile
- **AND** it SHALL report an unsupported-state failure to its caller or diagnostic channel

### Requirement: Transactional reconciliation
The profile control plane SHALL distinguish requested profile intent from confirmed applied state. It SHALL publish a non-converged phase when a core profile transition or rollback cannot be confirmed, and `reconcile` SHALL retry that transition deterministically.

#### Scenario: Core activation failure with successful rollback
- **WHEN** a requested profile activation fails and restoration of the prior applied profile succeeds
- **THEN** the requested mutation fails
- **AND** the prior converged state remains published

#### Scenario: Rollback failure
- **WHEN** profile activation fails and restoration cannot be confirmed
- **THEN** the requested mutation fails
- **AND** the published state identifies a rollback-failed phase with enough information for reconciliation

#### Scenario: Reconcile recovers interrupted state
- **WHEN** profile state is pending or rollback-failed
- **AND** the required core actuator becomes available
- **THEN** `reconcile` converges the resolved profile and updates the published applied profile

### Requirement: Profile controller command contract
The profile controller SHALL provide idempotent commands to set an automatic source claim, set or clear manual selection, return human-readable and JSON status, and reconcile state. Commands that cannot validate or persist requested state SHALL fail without reporting successful convergence.

#### Scenario: Source producer updates its exact claim
- **WHEN** an automatic producer sets a source claim to an exact count
- **THEN** repeating the same command does not change policy beyond the first update

#### Scenario: Manual selection command
- **WHEN** a user selects Auto, Default, Gaming, or Powersave
- **THEN** one controller operation records the complete selection change
- **AND** two manual modes are not simultaneously selected

#### Scenario: Status reflects canonical state
- **WHEN** a caller requests JSON status
- **THEN** the response represents one canonical profile-state generation

### Requirement: Passive profile consumers
UI and runtime consumers SHALL derive profile presentation from the canonical profile-state snapshot and SHALL not independently implement source aggregation or profile precedence.

#### Scenario: UI displays a manual override
- **WHEN** manual Power Saver overrides active automatic Gaming
- **THEN** the UI displays Power Saver as the selected and applied profile
- **AND** it can identify Gaming as an active automatic condition without treating it as the applied profile

#### Scenario: UI distinguishes Auto from manual Default
- **WHEN** automatic Gaming is active and the user selects manual Default
- **THEN** the UI displays Default as the selected and applied profile
- **AND** it presents Auto as a separate selection that would resume automatic Gaming

#### Scenario: Consumer starts during an active profile
- **WHEN** a profile consumer starts while a converged Gaming or Powersave profile is active
- **THEN** it initializes from the canonical snapshot without requiring an imperative profile-specific command

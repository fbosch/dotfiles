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
The profile control plane SHALL publish one profile-state snapshot that includes manual selection, automatic source claims, resolved profile, and a monotonically increasing generation. Consumers SHALL observe either the complete previous snapshot or the complete next snapshot.

#### Scenario: Successful state transition
- **WHEN** a requested profile transition converges
- **THEN** the published snapshot identifies the requested manual selection and resolved profile
- **AND** its generation is newer than the prior published snapshot

#### Scenario: Reader observes a state replacement
- **WHEN** a consumer reads profile state during publication
- **THEN** it observes a complete valid snapshot from one generation
- **AND** it does not observe a partially written document or mixed generation

### Requirement: Profile controller command contract
The profile controller SHALL provide idempotent commands to set an automatic source claim, set or clear manual selection, and return human-readable and JSON status. Commands that cannot validate or persist requested state SHALL fail.

#### Scenario: Source producer updates its exact claim
- **WHEN** an automatic producer sets a source claim to an exact count
- **THEN** repeating the same command does not invoke profile actuators or publish a new generation

#### Scenario: Manual selection command
- **WHEN** a user selects Auto, Default, Gaming, or Powersave
- **THEN** one controller operation records the complete selection change
- **AND** two manual modes are not simultaneously selected

#### Scenario: Status reflects canonical state
- **WHEN** a caller requests `status --json`
- **THEN** the response represents one canonical profile-state generation

### Requirement: Passive profile consumers
UI and runtime consumers SHALL derive profile presentation from the canonical profile-state snapshot and SHALL not independently implement source aggregation or profile precedence.

#### Scenario: UI displays a manual override
- **WHEN** manual Power Saver overrides active automatic Gaming
- **THEN** the UI displays Power Saver as the selected and resolved profile
- **AND** it can identify Gaming as an active automatic condition without treating it as resolved

#### Scenario: UI distinguishes Auto from manual Default
- **WHEN** automatic Gaming is active and the user selects manual Default
- **THEN** the UI displays Default as the selected and resolved profile
- **AND** it presents Auto as a separate selection that would resume automatic Gaming

#### Scenario: Consumer starts during an active profile
- **WHEN** a profile consumer starts while Gaming or Powersave is resolved
- **THEN** it initializes from the canonical snapshot without requiring an imperative profile-specific command

## Purpose

Persist accepted floating window geometry under stable policy identities and
restore it natively before initial layout, without generating rules or reloading
configuration when geometry changes.

## Requirements

### Requirement: Native window rules select persistence policies

The system SHALL declare persistence policies through `hl.window_rule(...)` in
`rules/persistent_position.lua`. Hyprland SHALL own matching, including multiple
match properties, negative regexes, declaration precedence, and rule enabled
state. The last applicable `persistent_position:remember` effect SHALL supply
the stable identity used for persisted state.

#### Scenario: Matching floating client is tracked
- **WHEN** a windowed floating client matches an enabled persistence rule
- **THEN** an accepted user move or resize records geometry under that rule's
  stable identity

#### Scenario: Excluded client is ignored
- **WHEN** Nemo's initial title matches `File Operations` or `Preparing`
- **THEN** the native negative initial-title matcher excludes it from Nemo's
  persistence policy

#### Scenario: Native precedence selects the identity
- **WHEN** a client matches multiple enabled rules specifying a persistence
  identity
- **THEN** the last applicable effect supplies the identity

#### Scenario: Disabled rule is ignored
- **WHEN** a persistence rule is disabled
- **THEN** that rule does not select geometry for capture or initial restoration

### Requirement: Unavailable plugin effects are not declared

The persistence rules module SHALL check the plugin adapter's enabled state
before declaring custom effects. The adapter SHALL require state API v2, native
rule API v1, and successful storage configuration before enabling persistence.

#### Scenario: Plugin loading is unavailable
- **WHEN** loading is deferred, rejected, or incompatible, or storage
  configuration fails
- **THEN** the persistence-only rule declarations are skipped
- **AND** ordinary window rules remain available without unknown persistence
  effect fields

### Requirement: Geometry is keyed by stable identity and monitor

Saved geometry SHALL use the literal persistence identity rather than a window
address, process ID, or generated regex-to-identity mapping. Ordinary policies
SHALL default to independent monitor-relative logical position and size for each
named monitor. An explicit global policy SHALL share one geometry record.

#### Scenario: Matcher changes preserve identity
- **WHEN** a rule's match expression changes but its persistence identity remains
  the same
- **THEN** its saved state remains associated with that identity

#### Scenario: Multiple monitors retain independent geometry
- **WHEN** a per-monitor policy captures geometry on a second monitor
- **THEN** it retains the first monitor's record and stores the second separately

### Requirement: Initial geometry is restored natively

The plugin SHALL read durable version-2 state at storage configuration time and
restore geometry from memory before initial layout. Ordinary policies SHALL
restore saved size and initial windowed state by default. Explicit move and
center rules SHALL retain precedence over ordinary saved position. Later
fullscreen requests SHALL remain available.

#### Scenario: Accepted geometry survives reopening
- **WHEN** a matching floating client reopens after an accepted capture
- **THEN** its selected saved size and monitor-relative position are restored
  before initial layout

#### Scenario: Saving does not publish generated rules
- **WHEN** an accepted user move or resize changes saved state
- **THEN** the plugin queues an asynchronous atomic state write
- **AND** it does not rewrite window rules, reload configuration, or reposition
  an already-open window to publish the save

### Requirement: PiP has a distinct accepted-placement profile

The `["persistent_position:profile"] = "pip"` effect SHALL select global
accepted-placement storage and saved-monitor routing without generic geometry
capture, size restoration, or initial-windowed forcing. The PiP reducer SHALL
remain authoritative for accepting corner or free placement and rejecting
transient Waybar avoidance.

#### Scenario: PiP placement is restored
- **WHEN** a PiP window reopens after an accepted corner or free placement
- **THEN** the plugin restores that placement using the final initial size
- **AND** a missing saved monitor uses normal routing without discarding state

### Requirement: Existing durable state remains usable

The implementation SHALL retain the existing version-2 state format and existing
literal policy identities. Unsupported or malformed state SHALL be rejected
without overwriting the file. Retired selector-table and generated-state files
SHALL NOT be read or migrated.

#### Scenario: Existing state survives the interface change
- **WHEN** the guarded native rules use the existing literal identities
- **THEN** the plugin reads their existing version-2 state without migration

#### Scenario: Invalid state is rejected safely
- **WHEN** the state file has an unsupported version or malformed records
- **THEN** configuration fails without replacing that file

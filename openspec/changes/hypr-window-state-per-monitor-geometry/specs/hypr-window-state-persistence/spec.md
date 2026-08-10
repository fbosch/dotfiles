## MODIFIED Requirements

### Requirement: Each selector retains independent geometry for each monitor
The system SHALL retain one geometry entry for each selector and monitor pair.
A later observed geometry for a selector on one monitor SHALL replace only that
monitor's entry and SHALL NOT replace entries for the same selector on other
monitors.

#### Scenario: Later movement replaces geometry on the same monitor
- **WHEN** a matching floating client is moved or resized on a monitor and its
  geometry becomes stable
- **THEN** the saved entry for that selector and monitor is updated to the
  later geometry

#### Scenario: Moving to another monitor preserves prior monitor state
- **WHEN** a matching floating client with saved geometry on one monitor is
  observed on another monitor
- **THEN** the system retains the first monitor's saved entry and records a
  separate entry for the later monitor

#### Scenario: Same selector has different geometry on two monitors
- **WHEN** a matching floating client has distinct stable geometry on two
  monitors
- **THEN** the system retains each monitor's position and size independently

### Requirement: Saved geometry is emitted as a monitor-scoped Hyprland window rule
The system SHALL generate a window-state rule for each saved selector and
monitor pair. The rule SHALL match the selector's client field and pattern and
the workspace hosted by the saved monitor, and SHALL set the saved size and
monitor-relative position without setting a monitor rule effect.

#### Scenario: Literal selector is matched exactly
- **WHEN** a selector pattern contains no regular-expression metacharacters
- **THEN** its generated window-rule matcher anchors the pattern at both ends

#### Scenario: Regular-expression selector is preserved
- **WHEN** a selector pattern contains regular-expression metacharacters
- **THEN** its generated window-rule matcher preserves the pattern

#### Scenario: Geometry is selected by the workspace monitor
- **WHEN** a new client opens on a workspace hosted by a monitor with saved
  geometry for its selector
- **THEN** the generated rule for that selector and monitor restores the saved
  size and monitor-relative position

#### Scenario: Saved geometry does not relocate the client
- **WHEN** a new client opens on a workspace hosted by a monitor with saved
  geometry for its selector
- **THEN** the generated rule does not direct the client to another monitor

#### Scenario: No geometry exists for the workspace monitor
- **WHEN** a new client opens on a workspace hosted by a monitor without saved
  geometry for its selector
- **THEN** no window-state rule applies geometry for that selector

### Requirement: Selector changes remove obsolete saved rules
The system SHALL remove every saved monitor-specific entry for selectors no
longer present in `rules/window-state-selectors.lua` when the configuration
reloads.

#### Scenario: Removed selector is pruned
- **WHEN** a previously saved selector is removed from the selector source and
  Hyprland reloads its configuration
- **THEN** the generated window-state rules no longer include any geometry for
  that selector on any monitor

#### Scenario: Remaining selector is retained
- **WHEN** one saved selector remains in the selector source after another is
  removed
- **THEN** the generated window-state rules retain every saved monitor-specific
  geometry for the remaining selector

## ADDED Requirements

### Requirement: Existing saved geometry is retained during the format transition
The system SHALL load an existing generated window-state rule that records its
monitor as a rule effect and retain its geometry as the corresponding
monitor-specific saved entry. The next generated output SHALL use
monitor-scoped matching without a monitor rule effect.

#### Scenario: Legacy saved rule is migrated
- **WHEN** the daemon starts with an existing generated rule containing saved
  geometry and a monitor rule effect
- **THEN** the saved geometry remains available for that monitor and the next
  generated rules file uses monitor-scoped matching instead of the monitor
  rule effect

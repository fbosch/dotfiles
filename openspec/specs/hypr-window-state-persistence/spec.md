## Purpose

Persist the last observed floating geometry for configured Hyprland clients and
restore it through generated window rules.

## Requirements

### Requirement: Configured selectors identify windows whose floating geometry is persisted
The system SHALL read window-state selectors from
`rules/window-state-selectors.lua` and persist geometry only for floating
clients that match a configured selector. A selector SHALL identify one of the
supported client fields and a pattern. When more than one selector matches a
client, the first configured matching selector SHALL identify the persisted
state.

#### Scenario: Matching floating client is tracked
- **WHEN** a floating client matches a configured selector
- **THEN** the system records its geometry using that selector

#### Scenario: Tiled client is ignored
- **WHEN** a client matching a configured selector is not floating
- **THEN** the system does not record its geometry

#### Scenario: Unmatched floating client is ignored
- **WHEN** a floating client does not match a configured selector
- **THEN** the system does not record its geometry

#### Scenario: First configured selector wins
- **WHEN** a floating client matches more than one configured selector
- **THEN** the system records its geometry using the first matching selector

### Requirement: Saved geometry is monitor-relative
The system SHALL record a matching floating client's position relative to the
origin of the monitor on which the client resides, together with its width and
height.

#### Scenario: Global client position is converted to monitor-relative position
- **WHEN** a matching floating client is positioned on a monitor whose origin
  is not `0,0`
- **THEN** the saved x and y coordinates equal the client position minus that
  monitor's origin

#### Scenario: Saved geometry includes size
- **WHEN** a matching floating client is tracked
- **THEN** the saved geometry includes its width and height

### Requirement: Each selector retains one last-observed geometry
The system SHALL retain one geometry entry for each selector. A later observed
geometry for the same selector SHALL replace the previous entry, including
when the client is on a different monitor.

#### Scenario: Later movement replaces saved geometry
- **WHEN** a matching floating client is moved or resized and its geometry
  becomes stable
- **THEN** the selector's saved entry is updated to the later geometry

#### Scenario: Moving to another monitor replaces prior monitor state
- **WHEN** a matching floating client is observed on a different monitor
- **THEN** the selector retains the later monitor and its geometry instead of
  retaining a separate entry for the previous monitor

### Requirement: Saved geometry is emitted as a Hyprland window rule
The system SHALL generate a window-state rule for each saved selector. The
rule SHALL match the selector's client field and pattern, set the saved size
and monitor-relative position, and direct the client to the saved monitor.

#### Scenario: Literal selector is matched exactly
- **WHEN** a selector pattern contains no regular-expression metacharacters
- **THEN** its generated window-rule matcher anchors the pattern at both ends

#### Scenario: Regular-expression selector is preserved
- **WHEN** a selector pattern contains regular-expression metacharacters
- **THEN** its generated window-rule matcher preserves the pattern

#### Scenario: Saved monitor is restored
- **WHEN** a generated window-state rule applies to a new client
- **THEN** the rule sets the client monitor to the monitor saved with the
  geometry

### Requirement: Generated rules persist across daemon restarts and reload dynamically
The system SHALL store saved geometry as generated Lua rules in
`rules/window-state.lua`. After a saved entry changes, it SHALL atomically
replace the generated rules file and refresh the window-state rule phase in
Hyprland.

#### Scenario: Saved geometry survives daemon restart
- **WHEN** the daemon restarts after a generated window-state rule exists
- **THEN** the daemon loads that rule as the selector's saved geometry

#### Scenario: Changed geometry refreshes active window-state rules
- **WHEN** saved geometry changes
- **THEN** the system regenerates the window-state rules and refreshes their
  Hyprland rule phase

#### Scenario: Unchanged geometry does not rewrite generated rules
- **WHEN** the generated rules already represent the saved geometry
- **THEN** the system does not rewrite the generated rules file or refresh the
  rule phase

### Requirement: Selector changes remove obsolete saved rules
The system SHALL remove saved entries for selectors no longer present in
`rules/window-state-selectors.lua` when the configuration reloads.

#### Scenario: Removed selector is pruned
- **WHEN** a previously saved selector is removed from the selector source and
  Hyprland reloads its configuration
- **THEN** the generated window-state rules no longer include that selector

#### Scenario: Remaining selector is retained
- **WHEN** one saved selector remains in the selector source after another is
  removed
- **THEN** the generated window-state rules retain the remaining selector's
  saved geometry

## Purpose

Defines predictable directional focus between visible tiled and floating windows
on the portrait and ultrawide custom Hyprland layouts.

## ADDED Requirements

### Requirement: Custom-layout directional focus includes tiled and floating windows
The system SHALL select from visible tiled and floating windows when directional
focus is invoked from a window on a portrait or ultrawide custom-layout
workspace.

#### Scenario: Tiled window focuses a floating window
- **WHEN** a visible floating window is the nearest eligible window to the
  right of a tiled active window on an ultrawide custom-layout workspace
- **THEN** directional focus right focuses the floating window

#### Scenario: Floating window focuses a tiled window
- **WHEN** a visible tiled window is the nearest eligible window below a
  floating active window on a portrait custom-layout workspace
- **THEN** directional focus down focuses the tiled window

### Requirement: Custom-layout directional focus selects the nearest directional window
The system SHALL select the visible candidate with the smallest centre-to-centre
distance in the requested direction, regardless of whether the candidate is
tiled or floating.

#### Scenario: Mixed candidates are ordered by distance
- **WHEN** tiled and floating candidates are both visible in the requested
  direction on a custom-layout workspace
- **THEN** directional focus selects the candidate nearest to the active window
  by centre-to-centre distance

#### Scenario: Opposite-side candidate is excluded
- **WHEN** a closer visible window lies opposite the requested direction and a
  farther visible window lies in the requested direction
- **THEN** directional focus selects the candidate in the requested direction

### Requirement: Unusable candidates do not affect custom-layout focus
The system SHALL ignore the active window, invisible windows, and windows
without usable position and size information when selecting a custom-layout
directional focus target.

#### Scenario: Invisible and incomplete windows are ignored
- **WHEN** invisible or geometrically incomplete windows are present with a
  visible geometrically valid candidate in the requested direction
- **THEN** directional focus selects the valid candidate

#### Scenario: No eligible local candidate preserves native edge behavior
- **WHEN** no visible geometrically valid window lies in the requested direction
  on a custom-layout workspace
- **THEN** the system retains its native directional-focus behavior

### Requirement: Directional-focus policy remains scoped to custom layouts
The system SHALL retain native directional-focus behavior outside the portrait
and ultrawide custom-layout workspaces.

#### Scenario: Non-custom workspace uses native focus
- **WHEN** directional focus is invoked from a workspace that does not use a
  portrait or ultrawide custom layout
- **THEN** the system uses native directional-focus behavior

### Requirement: Custom-layout focus crosses between paired monitors at layout edges
The system SHALL focus the nearest visible directional window on the paired
monitor when no same-workspace candidate exists at the portrait-right or
ultrawide-left custom-layout edge.

#### Scenario: Portrait right edge focuses ultrawide window
- **WHEN** no eligible window lies to the right of an active window on a
  portrait custom-layout workspace
- **THEN** directional focus right selects the nearest visible ultrawide window
  to the right

#### Scenario: Ultrawide left edge focuses portrait window
- **WHEN** no eligible window lies to the left of an active window on an
  ultrawide custom-layout workspace
- **THEN** directional focus left selects the nearest visible portrait window
  to the left

#### Scenario: Unpaired layout edges retain native focus
- **WHEN** directional focus is invoked at another custom-layout edge
- **THEN** the system retains native directional-focus behavior when no
  same-workspace candidate exists

### Requirement: Picture-in-Picture focus retains its existing policy
The system SHALL preserve the Picture-in-Picture focus override ahead of the
custom-layout directional-focus policy.

#### Scenario: Picture-in-Picture excludes floating candidates
- **WHEN** a Picture-in-Picture window has both floating and tiled windows in
  the requested direction
- **THEN** its directional focus behavior selects from eligible tiled windows
  rather than applying the mixed tiled/floating custom-layout policy

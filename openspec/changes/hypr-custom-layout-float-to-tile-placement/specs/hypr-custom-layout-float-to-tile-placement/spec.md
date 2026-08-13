## Purpose

Preserves a floating window's spatial position when tiling it into either local
custom layout, so `SUPER+V` places it in the nearest meaningful layout slot.

## ADDED Requirements

### Requirement: Float-to-tile placement uses the window center on the layout axis
When `SUPER+V` changes a floating window into a tiled window on a local custom
layout, the system SHALL capture the floating window's center coordinate before
the state change. `lua:ultrawide_master` SHALL use the horizontal center and
`lua:portrait_rows` SHALL use the vertical center.

#### Scenario: Floating window tiles on the ultrawide layout
- **WHEN** a floating window on `lua:ultrawide_master` is tiled with `SUPER+V`
- **THEN** its pre-toggle horizontal center is used to select its column

#### Scenario: Floating window tiles on the portrait layout
- **WHEN** a floating window on `lua:portrait_rows` is tiled with `SUPER+V`
- **THEN** its pre-toggle vertical center is used to select its row

### Requirement: Placement selects the nearest resulting slot center
The system SHALL evaluate the slot centers produced after the window joins the
tiled layout and place the window into the slot whose center has the smallest
absolute distance from the captured coordinate. If two slot centers are equally
layout and topmost on the portrait layout.

#### Scenario: Coordinate selects a non-default ultrawide column
- **WHEN** a floating window's horizontal center is nearest the center of a
  non-leading resulting ultrawide column
- **THEN** the window is placed in that column and the other tiled windows keep
  their relative order

#### Scenario: Coordinate selects a non-default portrait row
- **WHEN** a floating window's vertical center is nearest the center of a
  non-leading resulting portrait row
- **THEN** the window is placed in that row and the other tiled windows keep
  their relative order

#### Scenario: Coordinate is exactly between slot centers
- **WHEN** the captured coordinate is equally distant from two resulting slot
  centers
- **THEN** the window is placed in the earlier of those two slots

### Requirement: Float toggling retains safe fallback behavior
The system SHALL retain ordinary float-toggle behavior without custom
reordering when the active window is tiled, the workspace uses no local custom
layout, or the floating window lacks a stable identity or complete geometry.

#### Scenario: Tiled window becomes floating
- **WHEN** `SUPER+V` changes a tiled window into a floating window
- **THEN** no custom-layout ordering state is changed

#### Scenario: Floating window has incomplete geometry
- **WHEN** `SUPER+V` tiles a floating window whose center cannot be resolved
- **THEN** the window is tiled using ordinary layout insertion behavior

#### Scenario: Floating window is outside a local custom layout
- **WHEN** `SUPER+V` tiles a floating window on a workspace without a local
  custom layout
- **THEN** the window is tiled using ordinary float-toggle behavior

### Requirement: Placement requests are one-shot and scoped
The system SHALL apply a captured float-to-tile placement coordinate only to the
matching window's next tiled placement in the originating local custom-layout
context. It SHALL clear the request after consumption or expiration so it cannot
reorder a later unrelated placement.

#### Scenario: Matching tiled placement consumes the request
- **WHEN** the captured window enters the matching local custom layout
- **THEN** its coordinate is applied once and is then cleared

#### Scenario: Requested tile transition does not complete
- **WHEN** the captured window does not enter the matching tiled layout before
  the placement request expires
- **THEN** no later layout recalculation uses the stale coordinate

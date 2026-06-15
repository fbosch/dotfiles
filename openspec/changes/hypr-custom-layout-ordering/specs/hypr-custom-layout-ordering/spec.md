## ADDED Requirements

### Requirement: Directional move commands have explicit destination insertion semantics
The system SHALL treat cross-monitor directional move commands as explicit insertion intent for the destination custom layout.

#### Scenario: Portrait move right enters ultrawide at the leading edge
- **WHEN** the active tiled window is on the portrait monitor and the user invokes the move-right command
- **THEN** the window is moved to the ultrawide monitor and inserted as the leftmost ultrawide column

#### Scenario: Ultrawide move down enters portrait at the leading edge
- **WHEN** the active tiled window is on the ultrawide monitor and the user invokes the move-down command
- **THEN** the window is moved to the portrait monitor and inserted as the top portrait row

### Requirement: Same-layout directional move commands mutate stored order
The system SHALL handle directional move commands within a custom layout by moving the active target within the stored layout order.

#### Scenario: Ultrawide right move swaps toward the next column
- **WHEN** the active tiled window is on the ultrawide monitor and is not already the rightmost ordered target
- **THEN** the move-right command moves it one column to the right

#### Scenario: Portrait down move swaps toward the next row
- **WHEN** the active tiled window is on the portrait monitor and is not already the bottom ordered target
- **THEN** the move-down command moves it one row down

#### Scenario: Edge swaps are stable
- **WHEN** the active tiled window is already at the requested edge of its custom layout
- **THEN** the corresponding same-layout move command leaves the stored order unchanged

### Requirement: Transfer insertion ignores source-monitor geometry
The system SHALL NOT use source-monitor window geometry to choose the insertion position for a cross-monitor transfer.

#### Scenario: Source x outside ultrawide does not append the transferred window
- **WHEN** a portrait window is moved right to the ultrawide monitor and its last source x-coordinate is outside the ultrawide layout area
- **THEN** the window is inserted using the pending transfer intent, not the source x-coordinate or incoming target order

#### Scenario: Source y outside portrait does not choose a portrait row
- **WHEN** an ultrawide window is moved down to the portrait monitor and its last source y-coordinate is outside the portrait layout area
- **THEN** the window is inserted using the pending transfer intent, not the source y-coordinate or incoming target order

### Requirement: Geometry-based reordering is limited to confirmed same-layout repositioning
The system SHALL use target geometry to reorder windows only when the target is already established in the same layout scope.

#### Scenario: Same-layout drag reorders by current position
- **WHEN** an active target already belongs to the current workspace and monitor role and its current center moves inside the layout area
- **THEN** the layout may move that target to the slot matching its current center on the layout axis

#### Scenario: Cross-scope geometry does not reorder
- **WHEN** an active target enters a workspace, monitor role, or layout scope different from the scope where its last position was remembered
- **THEN** the layout does not use the remembered source-scope position to reorder that target

### Requirement: Newly spawned windows preserve existing order
The system SHALL insert newly spawned windows without reordering existing windows based on the spawned window's initial geometry.

#### Scenario: Spawned active window inserts after previous active target
- **WHEN** a new active window appears in a custom layout with existing ordered targets
- **THEN** the new window is inserted after the previously active target when that target still exists

#### Scenario: Spawned active window appends when no insertion anchor exists
- **WHEN** a new active window appears and the previously active target is unavailable
- **THEN** the new window is appended after the existing ordered targets

### Requirement: Mutating layout operations fail closed when active target is ambiguous
The system SHALL avoid mutating order or ratios when the active target cannot be resolved reliably.

#### Scenario: Swap no-ops without active target
- **WHEN** a custom layout receives a swap message and no current target can be identified as the active window
- **THEN** the stored order remains unchanged

#### Scenario: Resize no-ops without active target
- **WHEN** a custom layout receives an active-window resize message and no current target can be identified as the active window
- **THEN** the stored ratios remain unchanged

### Requirement: Target identity must be stable before persistent order state mutates
The system SHALL mutate persistent layout order only for targets with stable compositor identities.

#### Scenario: Missing stable identity uses source order for the frame
- **WHEN** one or more current targets lack a stable compositor identity
- **THEN** the layout places all targets for that frame without updating persistent order, seen-target state, or remembered positions for the unstable targets

#### Scenario: Duplicate target identity falls back to source order
- **WHEN** two or more current targets resolve to the same identity
- **THEN** the layout places the targets in source order for that frame and does not update persistent order for the duplicated identity

### Requirement: Reload initializes order from current destination geometry
The system SHALL recover stored order after layout module reload from confirmed current geometry when possible.

#### Scenario: Ultrawide order recovers from visible column positions after reload
- **WHEN** the ultrawide layout state is empty after reload and all current targets have valid centers inside the ultrawide layout area
- **THEN** the initial stored order is sorted by current x-center from left to right

#### Scenario: Portrait order recovers from visible row positions after reload
- **WHEN** the portrait layout state is empty after reload and all current targets have valid centers inside the portrait layout area
- **THEN** the initial stored order is sorted by current y-center from top to bottom

#### Scenario: Reload with incomplete geometry uses source order without mutation from geometry
- **WHEN** layout state is empty after reload and current target geometry is missing, outside the layout area, or mixed across monitor roles
- **THEN** the layout uses source order until a confirmed placement establishes layout-local positions

### Requirement: Monitor roles are resolved consistently across layout and keybind code
The system SHALL use a shared monitor-role mapping for portrait and ultrawide behavior.

#### Scenario: Ultrawide role dispatches ultrawide commands
- **WHEN** a window is on a monitor resolved as the ultrawide role
- **THEN** horizontal move and resize commands use ultrawide layout behavior

#### Scenario: Portrait role dispatches portrait commands
- **WHEN** a window is on a monitor resolved as the portrait role
- **THEN** vertical move and resize commands use portrait layout behavior

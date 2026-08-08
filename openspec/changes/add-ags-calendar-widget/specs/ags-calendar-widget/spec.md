## ADDED Requirements

### Requirement: Design-System Calendar Surface
The system SHALL define a read-only Calendar surface in `design-system/src/components/Calendar/` before implementing downstream desktop widgets.

#### Scenario: Calendar surface is pure UI
- **WHEN** the Calendar is rendered in the design system
- **THEN** it displays a calendar surface from supplied props
- **AND** it does not import or call AGS, Storybook, GNOME Calendar, Evolution Data Server, or shell-specific code

#### Scenario: Calendar is controlled by caller
- **WHEN** the caller changes `visibleMonth` or `selectedDate`
- **THEN** the Calendar renders the supplied Visible Month and Selected Day
- **AND** the Calendar reports user intent through callbacks instead of keeping persistent month or selected-date state internally

#### Scenario: Calendar exposes local export
- **WHEN** the Calendar component is added
- **THEN** `design-system/src/components/Calendar/index.ts` exports the Calendar component and related public types
- **AND** no design-system root export barrel is introduced for this slice

### Requirement: Calendar Month Grid
The Calendar SHALL render a fixed month grid optimized for date, weekday, public-holiday, and event-marker glancing.

#### Scenario: Fixed grid renders visible and outside-month days
- **WHEN** the Calendar renders a Visible Month
- **THEN** it renders exactly 42 Day Cells
- **AND** leading and trailing Outside-Month Days are muted

#### Scenario: Week start is configurable
- **WHEN** `weekStartsOn` is `0`
- **THEN** the weekday row and fixed grid start on Sunday
- **WHEN** `weekStartsOn` is `1` or omitted
- **THEN** the weekday row and fixed grid start on Monday

#### Scenario: Labels use optional locale
- **WHEN** the Calendar receives a `locale` value
- **THEN** month and weekday labels are formatted internally using that locale
- **AND** callers do not supply preformatted month or weekday labels

#### Scenario: Week numbers are omitted
- **WHEN** the Calendar renders the month grid
- **THEN** it does not render a week-number column

### Requirement: Calendar Events
The Calendar SHALL accept display-ready Events and render compact day-level indicators without exposing backend event metadata.

#### Scenario: Event shape is display-ready
- **WHEN** the Calendar receives Events
- **THEN** each Event contains only display fields such as id, title, start, end, all-day state, optional source name, optional color, and optional location
- **AND** the Calendar contract does not require recurrence rules, attendees, alarms, sync state, or backend source objects

#### Scenario: Local-day overlap controls event placement
- **WHEN** an Event overlaps one or more Local Days in the user's desktop timezone
- **THEN** the Calendar renders that Event's indicators on every overlapping Local Day
- **AND** timed Events crossing midnight appear on each overlapped Local Day
- **AND** all-day multi-day Events appear on each Local Day in their span

#### Scenario: Event markers are capped colored dots
- **WHEN** one or more Events overlap a Local Day
- **THEN** the Calendar renders capped colored Event Markers in that Day Cell
- **AND** markers use Event colors when valid
- **AND** markers fall back to the design-system accent color when Event colors are missing or invalid
- **AND** marker overflow is indicated without expanding the Day Cell

#### Scenario: Events render as markers with day tooltip details
- **WHEN** one or more Events overlap a Local Day
- **THEN** the Calendar renders Event Markers in that Day Cell
- **AND** it does not render Event text inside the Day Cell
- **AND** the Day Cell hover tooltip lists the Local Day's Events in caller-supplied Event Order

#### Scenario: Outside-month days do not render event labels
- **WHEN** an all-day Event overlaps an Outside-Month Day
- **THEN** the Calendar may render muted Event Markers
- **AND** it does not render Event text inside that Outside-Month Day

#### Scenario: Timed events do not render event text
- **WHEN** a timed Event overlaps a Day Cell
- **THEN** the Calendar renders Event Markers only
- **AND** it does not render timed Event titles or time labels in the month grid

#### Scenario: Event details are omitted
- **WHEN** the user hovers, focuses, or selects a Day Cell or Event indicator
- **THEN** the Calendar does not show an agenda panel, event detail popover, or event detail panel
- **AND** hover Event Details are limited to the Day Cell tooltip

### Requirement: Calendar Interaction
The Calendar SHALL support basic selection and navigation callbacks without shell-specific popup behavior.

#### Scenario: Month navigation reports caller intent
- **WHEN** the user activates previous, next, or today controls
- **THEN** the Calendar invokes the corresponding callback when provided
- **AND** it does not mutate persistent Visible Month state internally

#### Scenario: Day cells are native buttons
- **WHEN** the Calendar renders Day Cells
- **THEN** each Day Cell is a native button with `type="button"`
- **AND** Outside-Month Day Cells remain selectable
- **AND** each Day Cell is square

#### Scenario: Day selection is visual and callback-only
- **WHEN** the user activates a Day Cell
- **THEN** the Calendar invokes `onSelectDate` when provided
- **AND** the Calendar does not open event details or dismiss downstream widgets

#### Scenario: Keyboard scope is basic activation
- **WHEN** the user tabs through Calendar controls and Day Cells
- **THEN** controls and Day Cells are focusable and activatable with native button behavior
- **AND** arrow-key date navigation is not required in this slice

### Requirement: Backend Status Presentation
The Calendar SHALL keep date and weekday glancing usable when event data is loading or unavailable.

#### Scenario: Loading status is subtle
- **WHEN** backend status is `loading`
- **THEN** the Calendar still renders the month grid
- **AND** it displays subtle loading state without blocking date or weekday reading

#### Scenario: Unavailable or error status is non-blocking
- **WHEN** backend status is `unavailable` or `error`
- **THEN** the Calendar still renders the month grid
- **AND** it displays subtle status messaging
- **AND** it does not require Events to be present

### Requirement: Storybook References
The system SHALL provide Storybook stories as visual reference material for the Calendar surface only.

#### Scenario: Essential stories exist
- **WHEN** Calendar stories are added
- **THEN** they include open month, event markers with tooltips, backend unavailable, and reference-only Waybar spawning states
- **AND** they avoid exhaustive variant showcases

#### Scenario: AGS does not depend on stories
- **WHEN** the AGS Calendar Widget is implemented
- **THEN** it does not import, execute, or directly connect to Calendar Storybook stories

### Requirement: Calendar Date Helpers
The system SHALL colocate pure date logic with the Calendar component and validate it with tests.

#### Scenario: Date helpers build grid and event placement
- **WHEN** Calendar Date Helpers are implemented
- **THEN** they construct fixed 42-cell grids
- **AND** they evaluate Local Day overlap for timed and all-day Events
- **AND** they expose per-day Events in caller-supplied Event Order for tooltips

#### Scenario: Date helper tests cover core behavior
- **WHEN** design-system tests run
- **THEN** they cover fixed-grid construction, Sunday and Monday Week Start behavior, timed midnight-crossing Events, multi-day all-day Events, Outside-Month Day behavior, and Event ordering for tooltips

### Requirement: AGS Calendar Widget
The system SHALL add an AGS Calendar Widget that mirrors the design-system Calendar contract without importing React or Storybook code.

#### Scenario: Bundled component registration
- **WHEN** `ags-bundled` starts
- **THEN** the Calendar Widget is imported, initialized, and registered through the existing bundled component registry
- **AND** it responds under the `calendar-widget` instance name

#### Scenario: Request API supports widget state and navigation
- **WHEN** AGS receives Calendar Widget requests
- **THEN** it supports `show`, `hide`, `toggle`, `is-visible`, `next-month`, `prev-month`, `today`, and `select-date` actions

#### Scenario: Widget toggles from Waybar clock right-click
- **WHEN** the user right-clicks the Waybar clock
- **THEN** Waybar sends a Calendar Toggle request to `ags-bundled`
- **AND** the Calendar Widget opens when hidden and hides when visible

#### Scenario: Widget anchors near clock on trigger monitor
- **WHEN** the Calendar Widget is shown from Waybar
- **THEN** it appears near the bottom-right Clock Anchor on the Trigger Monitor when monitor detection succeeds
- **AND** it falls back to the default monitor when monitor detection fails

#### Scenario: Widget dismissal behavior
- **WHEN** the Calendar Widget is visible
- **THEN** Escape hides it
- **AND** clicking outside the Calendar Surface hides it
- **AND** selecting a Day Cell does not hide it

### Requirement: Waybar Visibility Guard
The system SHALL keep Waybar visible while the Calendar Widget is open.

#### Scenario: Calendar widget reports visibility
- **WHEN** the Waybar visibility helper checks whether Waybar should stay visible
- **THEN** it queries `calendar-widget` with `is-visible`
- **AND** it keeps Waybar visible when the Calendar Widget reports visible
- **AND** it treats request failure as not visible

#### Scenario: Widget show signals Waybar visible
- **WHEN** the Calendar Widget is shown
- **THEN** it signals Waybar to show
- **AND** it lets existing hide behavior decide after the widget closes

### Requirement: Read-Only Calendar Backend
The Calendar Backend SHALL read Events from visible Evolution Data Server calendar sources without mutating calendar data.

#### Scenario: Events come from visible EDS sources
- **WHEN** the Calendar Backend loads Events
- **THEN** it reads from enabled or visible EDS calendar sources that GNOME Calendar would expose for display
- **AND** it skips disabled or unavailable sources when that state is exposed

#### Scenario: Grid range controls event loading
- **WHEN** the Calendar Widget opens or the Visible Month changes
- **THEN** the Calendar Backend loads Events for the full Grid Range
- **AND** outside-month markers and cross-boundary Events are correct

#### Scenario: Backend is read-only
- **WHEN** the Calendar Widget displays Events
- **THEN** it does not create, edit, delete, RSVP, or manually sync Events

#### Scenario: Refresh occurs while visible
- **WHEN** the Calendar Widget is shown
- **THEN** it loads Events and starts EDS change watching when available
- **WHEN** the Calendar Widget is hidden
- **THEN** it stops EDS change watching
- **AND** continuous polling is not used in this slice

#### Scenario: EDS unavailable degrades safely
- **WHEN** EDS GIR bindings or services are unavailable
- **THEN** the Calendar Widget still opens
- **AND** the Calendar Surface still renders the month grid
- **AND** backend status communicates event unavailability without crashing `ags-bundled`

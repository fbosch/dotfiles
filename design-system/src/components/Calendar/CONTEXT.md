# Calendar Component

Design-system language for a read-only calendar surface. This context names the concepts used by the Calendar component and by downstream implementations, such as AGS widgets, that render the same visual contract.

## Language

**Calendar**:
The design-system React component and visual contract for displaying calendar days and event summaries. It is pure UI and has no desktop backend responsibility.
_Avoid_: calendar app, calendar backend, calendar popup

**Calendar Widget**:
A downstream desktop widget that implements the Calendar contract and handles shell-specific user interaction.
_Avoid_: Calendar, GNOME Calendar

**Calendar Toggle**:
The shell action that shows the Calendar Widget when hidden and hides it when visible. Waybar clock right-click uses Calendar Toggle; day selection does not dismiss the widget.
_Avoid_: one-way calendar open

**Popup Anchor**:
The shell UI region that makes the Calendar Widget feel attached to Waybar. While the Calendar Widget is open, it keeps Waybar visible and lets existing hide behavior take over after the widget closes.
_Avoid_: detached popup

**Clock Anchor**:
The bottom-right Waybar clock region used as the spatial anchor for the Calendar Widget. The Calendar Widget appears near the Clock Anchor rather than centered or attached to the cursor.
_Avoid_: cursor anchor, centered calendar popup

**Trigger Monitor**:
The monitor under the cursor when the Calendar Widget is shown from Waybar. The Calendar Widget opens on the Trigger Monitor when possible and falls back to the default monitor when monitor detection fails.
_Avoid_: always-primary-monitor popup

**Waybar Visibility Guard**:
The desktop helper state check that keeps Waybar visible while shell popups are open. The Calendar Widget participates in this guard through an `is-visible` request.
_Avoid_: one-shot Waybar show signal

**Calendar Backend**:
A read-only adapter that loads Events from a desktop calendar service for a Calendar Widget.
_Avoid_: Calendar, GNOME Calendar

**Visible Calendar Source**:
An enabled calendar source that the desktop calendar service exposes for display. The Calendar Backend reads Events only from Visible Calendar Sources, not from disabled or unavailable sources.
_Avoid_: all configured calendars

**Calendar Refresh**:
The Calendar Widget reloads Events when opened and when the Visible Month changes, and uses backend change notifications when available. Continuous polling is not part of the first slice.
_Avoid_: polling refresh

**Visible Watch**:
The Calendar Backend watches for Event changes only while the Calendar Widget is visible. Hiding the widget stops backend watches; showing it reloads the current Grid Range before watching again.
_Avoid_: daemon-lifetime calendar watch

**Event**:
A display-ready calendar entry normalized for the Calendar contract. It includes only what the Calendar needs to render, not backend metadata such as recurrence rules, attendees, alarms, or sync state.
_Avoid_: appointment, meeting, calendar item

**Visible Month**:
The month currently rendered by the Calendar. The Calendar owns visual month math such as a fixed 42-cell grid, leading/trailing days, today state, outside-month state, and event markers for the supplied Events.
_Avoid_: precomputed day grid

**Grid Range**:
The full Local Day range represented by the Calendar's fixed 42-cell grid, including leading and trailing Outside-Month Days. Calendar Widgets load Events for the Grid Range so outside-month markers and cross-boundary Events are correct.
_Avoid_: visible-month-only event range

**Month Navigation**:
Controls that ask the caller to move the Visible Month backward, forward, or back to today. The Calendar exposes navigation callbacks but does not own persistent month state.
_Avoid_: internal month state

**Controlled Calendar**:
A Calendar whose Visible Month and Selected Day are supplied by the caller. The Calendar reports user intent through callbacks and does not keep persistent month or selected-date state internally.
_Avoid_: uncontrolled calendar state, default visible month

**Calendar Surface**:
The renderable calendar UI without popup placement, dismissal, or shell behavior. Storybook stories are reference material for the Calendar Surface; downstream widgets such as AGS implementations do not directly connect to or depend on stories.
_Avoid_: popup component, Storybook integration

**Calendar Export**:
The local component export for the Calendar directory. The first slice adds a `Calendar/index.ts` export only and does not introduce a design-system root barrel.
_Avoid_: root export barrel

**Calendar Story**:
A Storybook reference for the Calendar Surface. The first slice keeps stories minimal: open month, event markers with tooltips, backend unavailable, and reference-only Waybar spawning.
_Avoid_: exhaustive variant showcase, AGS dependency

**Calendar Date Helper**:
Pure date logic colocated with the Calendar component, such as fixed-grid construction and Local Day overlap checks. Calendar Date Helpers support the Calendar contract but are not a bridge for AGS to import React or Storybook code.
_Avoid_: shared AGS runtime helper, story helper

**Calendar Date Helper Test**:
A unit test for Calendar Date Helper behavior, including fixed-grid construction, Week Start handling, Local Day overlap, Outside-Month Day behavior, and Event ordering for tooltips.
_Avoid_: Storybook-only date validation

**Backend Status**:
The Calendar Surface's minimal display state for Event availability. Loading, unavailable, and error states must keep the month grid usable for date and weekday glancing while showing subtle status messaging.
_Avoid_: blocking calendar state

**Local Day**:
A calendar day interpreted in the user's desktop timezone. Events appear on every Local Day they overlap, including timed Events that cross midnight and all-day Events that span multiple days.
_Avoid_: UTC day, backend day

**Week Start**:
The first weekday column rendered by the Calendar. Week Start is configurable as Sunday or Monday, with Monday as the default.
_Avoid_: locale auto-detection

**Week Number**:
An ISO-style numeric week indicator. Week Numbers are excluded from the first Calendar slice to preserve room for date readability and Event Markers.
_Avoid_: week column

**Calendar Locale**:
The locale used by the Calendar to format month and weekday labels. The Calendar formats labels internally from an optional locale value rather than accepting preformatted labels from callers.
_Avoid_: preformatted weekday labels, preformatted month labels

**Event Marker**:
A compact visual indication that one or more Events overlap a Local Day. The Calendar shows capped colored dots in the month grid, using Event colors when available and an overflow indicator when the cap is exceeded; it does not show Event text inside Day Cells.
_Avoid_: agenda, event list

**Event Color**:
The display color supplied for an Event by its source calendar. Event Colors are used for Event Markers when available; Day Cell text keeps Calendar-owned styling for readability.
_Avoid_: label color, generated event palette

**Event Color Fallback**:
The Calendar-owned fallback used when an Event Color is missing or invalid. Calendar implementations sanitize Event Colors at the render boundary and fall back to the design-system accent color rather than trusting source data blindly.
_Avoid_: backend-owned color fallback

**Event Tooltip**:
A hover tooltip on a Day Cell that lists the Events for that Local Day. Event details are available through the tooltip rather than truncated text inside the grid.
_Avoid_: day-cell event label, truncated event title

**Event Detail**:
Additional Event information beyond the compact month grid presentation. The first Calendar slice exposes Event Details only through Day Cell tooltips, not through popovers or an agenda panel.
_Avoid_: event popover, agenda panel

**Outside-Month Day**:
A Local Day rendered in the fixed grid but outside the Visible Month. Outside-Month Days may show muted Event Markers, but they do not render Event text inside Day Cells.
_Avoid_: adjacent-month label

**Event Order**:
The caller-controlled order of Events supplied to the Calendar. Day Cell tooltips list Events in caller-supplied Event Order.
_Avoid_: UI-inferred event priority

**Event Time**:
The start/end time range of an Event. Event Times are used for Local Day overlap logic but are not rendered in the first Calendar slice.
_Avoid_: time label, mini agenda

**Selected Day**:
The Local Day with selected visual state in the Calendar. Selecting a day may notify callers through a callback, but the Calendar does not perform any default action such as opening event details or dismissing downstream widgets.
_Avoid_: active event day

**Calendar Keyboard Scope**:
The first Calendar slice supports basic focus and activation for controls and day cells. Arrow-key date navigation is outside the first slice.
_Avoid_: full keyboard calendar navigation

**Day Cell**:
A square button representing a Local Day in the Calendar grid. Day Cells remain selectable for both Visible Month and Outside-Month Days and use native button activation semantics.
_Avoid_: inert day div, disabled outside-month day

## Example Dialogue

Dev: "Should the Calendar fetch events directly?"
Domain expert: "No. The Calendar is pure UI. A Calendar Widget asks a Calendar Backend for Events, then renders them using the Calendar contract."

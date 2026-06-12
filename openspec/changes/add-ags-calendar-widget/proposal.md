## Why

The Waybar clock currently opens GNOME Calendar as an application popup for calendar lookup. Replace that with a lightweight AGS Calendar Widget that is visually defined in the design system and reads the same event sources as GNOME Calendar without mutating calendar data.

## What Changes

- Add a read-only `Calendar` component contract under `design-system/src/components/Calendar/`.
- Add pure date helpers and tests for month grid construction, local-day overlap, event labels, and event markers.
- Add minimal Storybook reference stories for the Calendar surface; stories remain reference material and are not an AGS dependency.
- Add an AGS Calendar Widget under `.config/ags/lib/` that mirrors the design-system Calendar contract.
- Add a read-only Calendar Backend for Evolution Data Server events, with safe degradation when EDS GIR bindings are unavailable.
- Replace the Waybar clock right-click GNOME Calendar launcher with an AGS Calendar Toggle request.
- Extend Waybar visibility guarding so Waybar stays visible while the Calendar Widget is open.
- No event creation, editing, deletion, RSVP handling, manual syncing, agenda panel, event tooltips, or week numbers in this slice.

## Capabilities

### New Capabilities

- `calendar-widget`: Read-only calendar surface and AGS widget for date, weekday, public-holiday, and event-marker glancing.

### Modified Capabilities

- None.

## Impact

- `design-system/src/components/Calendar/`: New Calendar component, context, date helpers, tests, stories, and local export.
- `.config/ags/lib/`: New Calendar Widget and Calendar Backend implementation.
- `.config/ags/config-bundled.tsx`: Register the Calendar Widget in the bundled AGS daemon.
- `.config/waybar/config`: Replace clock right-click calendar action with AGS toggle.
- `.config/hypr/runtime/desktop/waybar-lib.sh`: Include Calendar Widget visibility in the Waybar visibility guard.
- Runtime dependency: EDS GIR bindings (`ECal`/`EDataServer`) must be available for event data. System dependency changes belong in the separate `fbosch/nixos` repo, not this dotfiles repo.

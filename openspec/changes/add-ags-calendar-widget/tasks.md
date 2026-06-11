## 1. Design-System Calendar Contract

- [x] 1.1 Add `design-system/src/components/Calendar/Calendar.tsx` with controlled surface props, public types, and Tailwind-only styling.
- [x] 1.2 Add `design-system/src/components/Calendar/calendar-date.ts` for fixed 42-cell grids, Week Start handling, Local Day overlap, Event Marker data, and caller-ordered Event tooltip data.
- [x] 1.3 Add `design-system/src/components/Calendar/index.ts` local exports for the Calendar component and public types.
- [x] 1.4 Ensure Day Cells are native `button type="button"` elements and support basic focus/activation without arrow-key date navigation.
- [x] 1.5 Ensure Backend Status states keep the month grid usable and render only subtle loading/unavailable/error messaging.

## 2. Design-System Tests and Stories

- [x] 2.1 Add unit tests for 42-cell grid construction with Monday and Sunday Week Start behavior.
- [x] 2.2 Add unit tests for Local Day overlap with timed midnight-crossing Events and multi-day all-day Events.
- [x] 2.3 Add unit tests for Outside-Month Day marker behavior and caller-ordered Event tooltip data.
- [x] 2.4 Add Calendar Storybook stories for open month, event markers with tooltips, backend unavailable, and reference-only Waybar spawning.
- [ ] 2.5 Run design-system validation with `pnpm lint` and `pnpm build` from `design-system/`.

## 3. AGS Calendar Widget Shell

- [ ] 3.1 Add `.config/ags/lib/calendar-widget.tsx` with lazy window creation and the `globalThis.CalendarWidget` component contract.
- [ ] 3.2 Mirror the design-system Calendar contract in GTK without importing React, Storybook stories, or design-system runtime code.
- [ ] 3.3 Implement request actions: `show`, `hide`, `toggle`, `is-visible`, `next-month`, `prev-month`, `today`, and `select-date`.
- [ ] 3.4 Anchor the Calendar Widget bottom-right near the Waybar clock on the Trigger Monitor, with default-monitor fallback.
- [ ] 3.5 Implement Escape and outside-click dismissal while keeping day selection from closing the widget.
- [ ] 3.6 Signal Waybar visible when the Calendar Widget is shown.

## 4. Bundled AGS Wiring

- [ ] 4.1 Add `CalendarWidget` to `.config/ags/config-bundled.tsx` global declarations.
- [ ] 4.2 Import `./lib/calendar-widget.tsx` in `.config/ags/config-bundled.tsx`.
- [ ] 4.3 Initialize and register `calendar-widget` in the bundled component registry.
- [ ] 4.4 Update bundled daemon component-count log text if it lists the number of initialized components.

## 5. Read-Only EDS Calendar Backend

- [ ] 5.1 Verify local GJS/AGS runtime availability for EDS GIR bindings (`ECal` and `EDataServer`).
- [ ] 5.2 If EDS GIR bindings are missing, document the required package change for the separate `fbosch/nixos` repo instead of adding Nix config here.
- [ ] 5.3 Implement a read-only Calendar Backend interface that loads display-ready Events for a Grid Range.
- [ ] 5.4 Load Events only from enabled or visible EDS calendar sources where source visibility is exposed.
- [ ] 5.5 Preserve source calendar color/name when available and normalize missing or invalid colors for Calendar fallback.
- [ ] 5.6 Start EDS change watching only while the Calendar Widget is visible, and stop watching when hidden.
- [ ] 5.7 Ensure EDS unavailable/error states do not crash `ags-bundled` and render the Calendar with Backend Status messaging.

## 6. Waybar Integration

- [ ] 6.1 Replace `.config/waybar/config` clock `on-click-right` GNOME Calendar action with `ags request -i ags-bundled calendar-widget '{"action":"toggle"}'`.
- [ ] 6.2 Keep `.config/waybar/config` clock `on-click` SwayNC behavior unchanged.
- [ ] 6.3 Update `.config/hypr/runtime/desktop/waybar-lib.sh` to query `calendar-widget` `is-visible`.
- [ ] 6.4 Ensure Waybar stays visible when start menu, SwayNC, taskbar apps, or Calendar Widget are visible.

## 7. Validation

- [ ] 7.1 Run `stow -n .` from the dotfiles repo root.
- [ ] 7.2 Run AGS type generation only if runtime GIR package availability changes require regenerated typings.
- [ ] 7.3 Verify `ags request -i ags-bundled calendar-widget '{"action":"is-visible"}'` returns a non-crashing response.
- [ ] 7.4 Verify Waybar clock right-click toggles the Calendar Widget and clock left-click still toggles SwayNC.
- [ ] 7.5 Compare visible public-holiday/all-day event markers and labels against GNOME Calendar for the current Grid Range.

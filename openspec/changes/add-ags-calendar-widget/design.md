## Context

The current Waybar clock right-click opens GNOME Calendar through the Hyprland taskbar popup system. The desired behavior is a lightweight AGS Calendar Widget that is defined from the design-system Calendar contract and backed by the same calendar service GNOME Calendar uses: Evolution Data Server.

The implementation spans two project areas: `design-system` defines the pure React/Tailwind Calendar Surface and AGS implements a GTK widget that mirrors that contract. Storybook stories are reference material only; AGS must not import or depend on them. System package and runtime dependency changes, such as adding EDS GIR bindings, are owned by the separate `fbosch/nixos` repository rather than this dotfiles repository.

## Goals / Non-Goals

**Goals:**

- Define a read-only design-system Calendar Surface before implementing AGS.
- Optimize the Calendar for date, weekday, public-holiday, and compact event-marker glancing.
- Keep the Calendar controlled, surface-only, and backend-agnostic.
- Add tests for the date helper behavior that determines fixed grids, local-day overlap, and labels.
- Implement an AGS Calendar Widget in `ags-bundled` that mirrors the Calendar contract.
- Read Events from visible EDS calendar sources when EDS is available.
- Replace Waybar clock right-click GNOME Calendar launching with Calendar Widget toggling.
- Keep Waybar visible while the Calendar Widget is open.

**Non-Goals:**

- Creating, editing, deleting, accepting, declining, or manually syncing Events.
- Rendering an agenda panel, event detail popup, event times, or week numbers.
- Importing React, Storybook, or design-system runtime code into AGS.
- Adding Nix package configuration in this dotfiles repository.
- Continuous event polling.

## Decisions

### Design-system first, AGS mirrors the contract

The Calendar starts in `design-system/src/components/Calendar/` as the visual and data contract. AGS implements the same concepts in GTK rather than importing React or Storybook code.

Alternative considered: implement AGS first and backfill design-system later. Rejected because this would let the runtime widget define visual behavior separately from the design-system source of truth.

### Calendar is surface-only and controlled

The Calendar receives `visibleMonth`, `selectedDate`, Events, status, locale, and Week Start from the caller. It exposes callbacks for selection and Month Navigation. Popup placement, dismissal, Waybar visibility, and backend loading belong to the Calendar Widget.

Alternative considered: include open/close popup behavior in the Calendar component. Rejected because shell placement and layer behavior are AGS concerns and would make the design-system component less reusable.

### Calendar owns visual date math

The Calendar owns fixed 42-cell grid construction, Outside-Month Day state, Local Day overlap, Event Marker placement, and caller-ordered per-day Event data for tooltips. Pure date helpers are colocated with the Calendar and tested.

Alternative considered: callers pass a precomputed grid. Rejected because it would duplicate visual date math across Storybook, AGS, and future callers.

### Events are display-ready summaries

Events in the Calendar contract contain only display fields needed by the month grid: id, title, start/end, all-day state, optional source name, optional color, and optional location. Backend details such as recurrence rules, attendees, alarms, source objects, and sync state are hidden by the Calendar Backend.

Alternative considered: expose richer EDS event data to the Calendar. Rejected because it couples pure UI to backend semantics and broadens the first read-only slice.

### Event marker and tooltip behavior

The Calendar shows Events as capped colored dots with overflow indication. Day Cells do not render truncated Event text; hovering a Day Cell uses the native tooltip to list that Local Day's Events in caller-supplied order. Event times, popovers, and agenda panels are excluded.

Alternative considered: render all-day Event titles in cells. Rejected because labels truncate in the compact grid and reduce date readability.

### EDS backend is visible-only and read-only

The Calendar Backend loads Events from visible/enabled EDS calendar sources for the full Grid Range when the widget opens or the Visible Month changes. It watches for EDS changes only while the Calendar Widget is visible and does not poll continuously.

Alternative considered: keep an EDS watch active for the whole AGS daemon lifetime. Rejected because open/month-change loading catches up on demand and visible-only watching reduces shared daemon risk.

### Waybar integration replaces right-click only

The clock left-click continues to toggle SwayNC. Clock right-click sends `ags request -i ags-bundled calendar-widget '{"action":"toggle"}'`. The Calendar Widget participates in the existing Waybar Visibility Guard through `is-visible`.

Alternative considered: replace clock left-click too. Rejected because current left-click behavior is unrelated and should remain stable.

## Risks / Trade-offs

- EDS GIR bindings may be missing locally -> the widget must degrade safely, and package requirements must be documented for `fbosch/nixos` rather than implemented here.
- GJS EDS APIs may be awkward or unavailable through generated typings -> backend discovery is an explicit first AGS phase, and `ags-bundled` must not crash when bindings cannot load.
- React Calendar and AGS Calendar can drift visually -> Storybook remains reference material, and the AGS implementation must mirror the same named states and contract terms.
- Local Day behavior can regress around midnight/all-day boundaries -> pure date helper tests cover crossing-midnight and multi-day all-day Events.
- Waybar auto-hide could detach the popup -> the Calendar Widget signals Waybar visible on show and participates in the Waybar Visibility Guard while open.

## Migration Plan

1. Build and validate the design-system Calendar Surface, helpers, tests, and reference stories.
2. Add the AGS Calendar Widget to `ags-bundled` with backend unavailable state first.
3. Discover EDS GIR availability and implement the read-only Calendar Backend when available.
4. Replace Waybar clock right-click with Calendar Toggle.
5. Extend the Waybar Visibility Guard to query `calendar-widget is-visible`.
6. Roll back by restoring the previous Waybar right-click action to `~/.config/hypr/taskbar/actions.sh calendar`.

## Runtime Dependency Note

Local AGS runtime discovery on 2026-06-11 showed the current AGS environment cannot load EDS by default: `Typelib file for namespace 'ECal', version '2.0' not found`. `ECal-2.0.typelib` and `EDataServer-1.2.typelib` exist under `/run/current-system/sw/lib/girepository-1.0`, so the AGS daemon startup now exposes that directory through `GI_TYPELIB_PATH`. Loading `ECal` then requires transitive typelibs that are not in the current system profile, specifically `ICalGLib-3.0` from `libical` and `Json-1.0` from `json-glib`. Adding those GIR typelibs to the system profile belongs in `fbosch/nixos`, not this dotfiles repo.

With a temporary full `GI_TYPELIB_PATH` containing EDS, 64-bit `libical`, and `json-glib`, AGS can import `ECal`/`EDataServer`, list 3 enabled calendar sources, and read 30 components from the Denmark Holidays source via `get_object_list_as_comps_sync("#t", null)`. Current visible grid testing returned zero components for the active month, so marker rendering still needs validation against a month that contains EDS events after the runtime dependency path is fixed.

## Performance Baseline

Benchmarking on 2026-06-11 uses `.config/ags/scripts/benchmark/run-benchmarks.sh` with `BENCH_RESTART=1 BENCH_CALENDAR_CYCLES=12 BENCH_COMPONENT_CYCLES=10 BENCH_MEM_CYCLES=30`. The script now waits for an AGS request-handler readiness probe before measuring, exports the system GIR path when it starts the daemon, and writes summaries to `$XDG_RUNTIME_DIR/ags-benchmark-summary.json`.

Calendar Widget baseline after caching marker CSS by event color:

- IPC/request-facing latency: cold show 51ms, warm show 27ms, next-month average 22ms, previous-month average 22ms, today 10ms.
- `calendar-widget.handleRequest`: average 4.95ms, p95 11.21ms, max 39.14ms over 30 requests.
- `calendar-widget.renderCalendar`: average 1.87ms, p95 3.33ms, max 24.79ms over 82 renders.
- `calendar-widget.loadEventsForVisibleGrid`: median 8.83ms, analyzer p95 18.52ms, max 4066.11ms over 27 loads. The max is the cold EDS client/source path; warm cached range loads stay low.
- Process memory during the calendar sequence showed 0KB RSS/PSS delta in this run.

The main remaining optimization candidate is cold EDS client connection. It happens in the background after the request returns, but it can still block the shared GJS main loop during the first backend load. The current source-client and grid-range caches are necessary and should stay. Further work should target reducing or deferring cold EDS connection cost only if it causes visible UI stalls in normal use.

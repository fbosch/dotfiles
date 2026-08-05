## Context

See `proposal.md` for motivation. The current Start Menu already has an AGS shell surface, profile controls, update-cache reads, confirmation scripts, Waybar triggering, and an application icon resolver. The design system now has Start Menu, Force Quit, and About This PC reference surfaces, but the AGS runtime does not yet mirror their data and interaction contract.

AGS runs as one bundled daemon. The implementation must keep the Start Menu responsive, avoid daemon-lifetime polling where event-driven data is available, and not import React or Storybook at runtime.

## Goals / Non-Goals

**Goals:**

- Make the design-system surfaces the visual and display-data contract for AGS.
- Keep application history session-scoped and event-driven.
- Use the existing icon-resolution boundary and initial-letter fallback.
- Limit `/proc` polling to the visible Force Quit surface.
- Keep destructive session and process actions bounded, revalidated, and recoverable where possible.
- Keep all menu, dialog, and application windows visually consistent with the established tokens, shared buttons, radii, blur, and transparency.

**Non-Goals:**

- Persisting application recency across AGS or desktop-session restarts.
- Replacing the existing update, profile, session-confirmation, or Waybar systems.
- Building a general application launcher, usage tracker, process manager, user switcher, or system settings framework.
- Adding new runtime packages or a configuration framework.

## Decisions

### Design system defines display-ready surfaces; AGS owns desktop state

The design-system components accept display-ready items, counts, process metrics, and device fields, then report user intent through callbacks. AGS owns Hyprland state, XBEL parsing, cache-file reads, process discovery, command execution, and cleanup.

This keeps Storybook useful without simulating desktop services and prevents runtime-specific state from leaking into React component contracts.

Alternative considered: AGS-specific behavior inside design-system components. Rejected because it would couple pure UI to GJS, local files, and compositor state.

### Recent applications use in-memory Hyprland focus history

AGS records focus events for the active desktop session in a bounded in-memory history. A history entry records the application identity needed to resolve an icon and desktop launch target. The history is de-duplicated by application identity while preserving recency.

On menu open, the adapter evaluates the latest entries, retains closed applications only when they have a launchable desktop entry, and limits output to eight items. Activating a recent application launches a new instance rather than focusing an existing window.

Alternative considered: polling current clients on menu open. Rejected because it cannot reliably reconstruct recency. Persisted history was rejected because the desired scope is the current session only.

### Existing icon resolver is the single application-icon boundary

Recent Applications and Force Quit resolve icons through `.config/ags/lib/app-icons.ts`. That resolver already handles desktop entries, Waybar mappings, Steam, Faugus, themes, and file icons. When resolution fails, callers use its initial-letter fallback.

Alternative considered: separate menu-specific icon lookup. Rejected because it would duplicate desktop-entry and game-wrapper knowledge.

### Recent documents use XBEL and clear only the selected sources

The document adapter reads `recently-used.xbel` through an XML-capable parser, deduplicates and orders display-ready document entries, and limits them to twelve. It treats missing or malformed input as no documents.

Clear Recent Items clears the session in-memory application history and the XBEL document-history file only. It does not mutate GNOME application-usage state or unrelated desktop history.

Alternative considered: regex parsing and GNOME state deletion as used by Kiwi. Rejected because serialized XML is not a regex format and AGS must not erase state it does not own.

### Recent Items is a bounded submenu with accessible pointer and keyboard behavior

The submenu bottom-aligns to its trigger and grows upward. At show time, AGS checks the trigger-monitor work area; it opens right when space permits and left otherwise. Pointer entry starts a 300 ms open delay, pointer leave starts a 200 ms close delay, and movement into the submenu cancels close. Click and keyboard activation open immediately.

The focused interaction model owns timer cancellation, focus return, Escape ordering, and outside-click dismissal. It is local to the menu surface rather than exposed through callers.

Alternative considered: immediate hover or click-only opening. Rejected because the first is easy to trigger accidentally and the second loses expected desktop-menu behavior.

### Session actions hide the menu before command dispatch

Every session action hides Start Menu before command dispatch. Lock invokes `hyprlock` directly. Log out, suspend, restart, and shutdown reuse the existing confirmation scripts. The Start Menu does not duplicate confirmation UI or session-command logic.

Alternative considered: keeping the menu visible behind confirmation surfaces. Rejected because it causes layer and focus ambiguity and leaves stale UI behind lock screens.

### Force Quit groups windows by application and escalates safely

Force Quit derives groups from current Hyprland clients using resolved desktop application identity, with class-based identity as fallback. A group aggregates its window set, unique PIDs, icon reference, CPU ticks, and resident memory. Core desktop processes and the shell's own surfaces are excluded.

The action first requests close for grouped windows. After one bounded grace interval, it re-queries relevant state and terminates only surviving revalidated PIDs. A vanished application clears selection and refreshes silently. The visible window owns a 2-second metric refresh timer and removes it whenever hidden or destroyed.

Alternative considered: immediate signal-based termination. Rejected because it loses normal application shutdown opportunities. A generic process list was rejected because users choose applications, not arbitrary processes.

### About This PC uses explicit host configuration with a chassis fallback

`AGS_ABOUT_DEVICE_IMAGE` is read when About opens. A readable configured image takes precedence. Otherwise AGS maps portable DMI chassis types to a Fluent laptop icon and desktop/unknown types to a Fluent Desktop Tower icon. The data loader omits unreadable or placeholder fields and supplies model, vendor, CPU, CPU clock rate, GPU, memory, memory clock frequency, desktop, operating-system, kernel, and uptime data.

More Info launches a terminal running `fastfetch`. The surface has no titlebar decoration and inherits the established translucent Window treatment.

Alternative considered: a JSON settings file or Nix-generated value. Rejected because one scoped environment variable meets the host-specific requirement without a new configuration path.

### Data loading happens on open; exceptions are explicit

Start Menu opening reloads XBEL and both update caches before rendering. About and Force Quit reload their data when opened. Focus history remains event-driven in memory because no open-time source can reconstruct it. Force Quit CPU sampling is visible-only because a percentage requires time-separated samples.

Alternative considered: persistent monitors and polling for every data source. Rejected because open-time reads meet freshness needs while reducing daemon-lifetime state and wakeups.

## Risks / Trade-offs

- [Hyprland client metadata can be incomplete] -> Group identity falls back from desktop identity to application class, then the existing icon fallback letter.
- [A closed app can lack a launchable desktop entry] -> Remove it from recent applications rather than render a misleading action.
- [XBEL can be unavailable or malformed] -> Render documents as empty and log the read failure without blocking Start Menu.
- [Desktop shutdown can race process termination] -> Revalidate windows and PIDs after the grace interval and treat vanished apps as resolved.
- [DMI values are often placeholders or unreadable] -> Filter known placeholder text and use the chassis icon fallback.
- [Panel-edge placement varies by monitor] -> Derive placement from the trigger monitor work area at show time and use a deterministic left-side fallback.
- [React and GTK can drift visually] -> Keep named states and Storybook stories aligned with the AGS rendering contract, then validate both after each visual change.

## Migration Plan

1. Align the existing design-system Start Menu, Force Quit, and About This PC contract with this specification, including stories and tests.
2. Add isolated AGS adapters for focus history, recent documents, Force Quit data/action handling, and About data loading.
3. Mirror the final menu structure and interaction state in the existing bundled Start Menu component.
4. Preserve existing `start-menu` IPC and Waybar trigger behavior while adding focused internal surfaces or registered components only where required.
5. Validate repeated show/hide behavior, session-action ordering, destructive-action revalidation, and performance.
6. Remove `design-system/docs/plans/kiwi-inspired-start-menu.md` after the OpenSpec artifacts are complete.

Rollback restores the prior Start Menu item layout and removes newly registered AGS surfaces or adapters. Existing confirmation scripts, update commands, and Waybar request syntax remain valid throughout.

## 1. Design-System Start Menu Contract

- [x] 1.1 Align `StartMenu` public types and default items with the specified grouped order, including source-specific Nix flake and Flatpak update badges.
- [x] 1.2 Align Recent Items data, upward submenu placement, pointer timing, keyboard navigation, focus return, and edge-flip reference behavior with the specification.
- [x] 1.3 Align `ForceQuitDialog` with compact grouped application rows, selection state, disabled action state, and undecorated translucent shared-window styling.
- [x] 1.4 Align `AboutThisPC` with optional parenthesized CPU and memory clock details, GPU, OS codename, kernel, and uptime rows, configured-image and Fluent fallback display states, and the fastfetch More Info intent.
- [x] 1.5 Update Start Menu, Force Quit, and About This PC stories to cover populated, empty, unavailable, source-badge, and optional-information states without runtime dependencies.
- [x] 1.6 Add focused design-system tests for Start Menu keyboard/submenu behavior and pure display-data helpers introduced by this change.

## 2. Recent Item Data Adapters

- [ ] 2.1 Add a bounded, session-scoped Hyprland focus-history adapter that records application identity without persistence.
- [ ] 2.2 Resolve launchable recent applications and icons through the existing app-icons resolver, retaining closed apps only when they have a desktop launch target.
- [ ] 2.3 Add a Recent Documents adapter that parses `recently-used.xbel` with an XML-capable parser, limits entries, and degrades to an empty section on unreadable or malformed input.
- [ ] 2.4 Implement recent application launch-new and document URI-opening actions without shell interpolation.
- [ ] 2.5 Implement Clear Recent Items for only in-memory application history and XBEL document history, then refresh the visible submenu state.

## 3. AGS Start Menu Interaction

- [x] 3.1 Mirror the design-system action grouping, profile header, update badges, and Nerd Font source icons in `.config/ags/lib/start-menu.tsx`.
- [ ] 3.2 Reload XBEL documents and Nix/Flatpak update caches when Start Menu opens, hiding invalid, stale, missing, or zero-count source badges.
- [ ] 3.3 Implement the Recent Items submenu's 300 ms open delay, 200 ms close delay, immediate click/keyboard activation, timer cleanup, and Escape/focus behavior.
- [ ] 3.4 Position the submenu upward on the trigger monitor and flip it left when the monitor work area lacks room on the right.
- [ ] 3.5 Hide Start Menu before dispatching lock, logout, suspend, restart, and shutdown; retain direct lock and existing confirmation-script behavior for the other session actions.
- [ ] 3.6 Preserve `show`, `hide`, `toggle`, `refresh`, and `is-visible` Start Menu requests and the existing Waybar trigger/visibility behavior.

## 4. Force Quit Runtime

- [ ] 4.1 Add a Force Quit data adapter that groups current Hyprland clients by application identity, aggregates unique PIDs, resolves icons, and excludes protected desktop processes and shell surfaces.
- [ ] 4.2 Add visible-only two-second CPU/RSS metric sampling with deterministic cleanup when Force Quit hides or is destroyed.
- [ ] 4.3 Implement graceful window-close, bounded revalidation, and forced termination of surviving selected application processes.
- [ ] 4.4 Handle already-exited applications by clearing selection and refreshing the list without an error surface.
- [ ] 4.5 Keep Force Quit open after successful action, remove the resolved application, and refresh metrics/list data.

## 5. About This PC Runtime

- [ ] 5.1 Add an About data adapter that reads model, manufacturer, CPU, CPU clock rate, GPU, memory, memory clock frequency, desktop, operating-system name and codename, kernel, and uptime while filtering unreadable and placeholder fields.
- [ ] 5.2 Read `AGS_ABOUT_DEVICE_IMAGE` on open and use it when readable; otherwise map portable chassis types to a Fluent laptop icon and desktop/unknown types to Desktop Tower.
- [ ] 5.3 Implement an undecorated translucent About surface and route More Info to a terminal running `fastfetch`.

## 6. Validation And Documentation

- [ ] 6.1 Run focused design-system validation: Biome, contrast validation, Storybook build, component tests, and accessibility checks when the local browser runtime is installed.
- [ ] 6.2 Run `stow -n .` and AGS type validation; regenerate typings only if the runtime API surface changes.
- [ ] 6.3 Verify Start Menu IPC, Waybar toggle, submenu timing/edge placement, session-action dismissal order, update-badge degradation, and recent-item clear behavior in a live Hyprland session.
- [ ] 6.4 Verify Force Quit grouping, protected-process exclusion, graceful-close escalation, vanished-app behavior, and timer cleanup in a live session.
- [ ] 6.5 Run the focused AGS component benchmark and verify repeated Start Menu, Force Quit, and About open/close cycles do not retain timers, monitors, subprocess handles, or growing memory.
- [x] 6.6 Remove the superseded `design-system/docs/plans/kiwi-inspired-start-menu.md` after OpenSpec artifacts are accepted.

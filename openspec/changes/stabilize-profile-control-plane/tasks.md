## 1. Characterize Profile Policy

- [x] 1.1 Add a production `profilectl` fixture for failed restore, state publication, manual selection, and rollback paths.
- [x] 1.2 Add fixture cases for Auto to automatic Gaming, Auto to automatic Powersave, Gaming-over-Powersave precedence, and multiple automatic Gaming sources.
- [x] 1.3 Add fixture cases for manual Default, Gaming, and Powersave overrides during automatic Gaming, plus clearing manual selection back to Auto.
- [x] 1.4 Define fixture seams for bounded actuator timeout, malformed state, atomic reader snapshots, and interrupted controller invocations.

## 2. Stabilize Profilectl State And Commands

- [x] 2.1 Add validated canonical profile state with atomic same-directory publication and generation tracking.
- [x] 2.2 Move in-repository Auto callers to `clear-manual`, then replace counted manual sources with one explicit Auto, Default, Gaming, or Powersave selection while preserving automatic source claims.
- [x] 2.3 Add idempotent exact-source updates and JSON status.
- [ ] 2.4 Retain existing profilectl commands as tested compatibility wrappers and produce read-only legacy state projections during consumer migration.
- [ ] 2.5 Add bounded core and optional actuator handling with explicit degraded state and recovery diagnostics.

## 3. Migrate Profile Producers And Consumers

- [x] 3.1 Migrate the gaming watchdog and all manual profile actions to the explicit controller contract.
- [x] 3.2 Add one AGS profile-state service and migrate Gaming opacity, Start Menu, and Window Switcher to passive canonical-state reads, including separate Auto and Default controls.
- [x] 3.3 Add one Lua profile-state reader and migrate Hyprland reload and custom-layout recovery from overlay markers.
- [x] 3.4 Gate gaming presentation updates on canonical resolved profile state so manual non-Gaming overrides remain effective.
- [x] 3.5 Remove the imperative Window Switcher profile request after the component follows canonical state.

## 4. Clean Actuator Boundaries

- [x] 4.1 Add ownership-aware Window Capture pause, resume, refresh, and status operations while preserving worker ownership behavior.
- [x] 4.2 Replace profilectl process-name signals and implementation-path invocation with the Window Capture feature interface.
- [x] 4.3 Extend capture and profile fixtures for pause/resume idempotence, failed refresh, and no-unrelated-process signaling.

## 5. Retire Legacy State And Validate

- [x] 5.1 Remove legacy count and overlay-marker readers after every in-repository consumer uses canonical state.
- [x] 5.2 Remove legacy state projections and obsolete profilectl compatibility commands after their callers are gone.
- [ ] 5.3 Run profile fixtures, `devenv test`, AGS type validation, and targeted AGS benchmarks.
- [ ] 5.4 Verify manual overrides, automatic recovery after Auto, AGS restart during active profiles, and Window Capture behavior in a live Hyprland session.

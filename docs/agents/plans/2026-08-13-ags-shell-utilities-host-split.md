# Split AGS Shell And System Utilities Hosts

## Problem

`config-bundled.tsx` currently loads all AGS surfaces into one `ags-bundled`
process. That includes latency-sensitive shell UI and task-oriented windows:

- Shell UI needs to be ready at login and immediately responsive to regular
  input. The Window Switcher is created at startup for modifier handling, the
  Start Menu maintains session integrations, and the Audio Mixer initializes an
  audio backend.
- About This PC and Force Quit create their windows only when requested and
  destroy them on dismissal. They are opened from Start Menu through direct
  `globalThis` calls, which prevents them from moving to another process.

Keeping those categories together will make the login-critical shell host grow
with every new task-oriented system window. A separate source module is not
enough: `config-bundled.tsx` imports and initializes every module in the same
GTK application.

## Decision

Use two AGS application instances:

```text
ags-bundled                         ags-utilities
starts at login                     starts on first utility request
remains session-persistent          remains alive after first request

Start Menu                          About This PC
Window Switcher                     Force Quit
Volume indicator                    Future system utilities
Keyboard switcher
Audio Mixer
Calendar
Desktop Clock
PiP snap preview
Confirmation dialog
```

Keep the existing `ags-bundled` instance name and `config-bundled.tsx` file
for the shell host. This avoids unnecessary churn in existing Waybar,
Hyprland, and command callers. Add `config-utilities.tsx` with the distinct
instance name `ags-utilities`.

The utility host is a single shared process, not one AGS process per utility.
It starts lazily, then stays alive until graphical-session teardown. AGS 3's
application implementation calls `Gtk.Application.hold()` for its primary
instance, but the implementation must verify that `ags-utilities` remains
reachable after its last window closes.

### Classification Rule

A surface belongs to the shell host when it needs immediate session-start
availability, frequent interaction, continuous subscriptions, modifier/input
coordination, or loss of it would impair ordinary desktop operation.

A surface belongs to the utility host when it is a bounded inspect, repair,
configure, or administration task that can fail or restart without removing
routine desktop interaction. Naming alone is not a criterion.

This classifies the existing components as follows:

| Component | Host | Reason |
| --- | --- | --- |
| `start-menu` | Shell | Primary launch surface with session cache and profile integrations. |
| `window-switcher` | Shell | Requires startup construction for modifier-release behavior. |
| `volume-indicator` | Shell | Immediate feedback surface driven by continuous monitoring. |
| `keyboard-switcher` | Shell | Immediate feedback surface for layout changes. |
| `audio-mixer-widget` | Shell | Frequent desktop control with backend initialization at host startup. |
| `calendar-widget` | Shell | Regular taskbar-adjacent interactive overlay. |
| `desktop-clock` | Shell | Persistent desktop presentation surface. |
| `pip-snap-preview` | Shell | Compositor-interaction feedback surface. |
| `confirm-dialog` | Shell | Session and high-impact action confirmation surface. |
| `about-this-pc` | Utilities | On-demand host inspection; its window and inspection work are transient. |
| `force-quit` | Utilities | An occasional recovery task that enumerates applications and performs process termination. |
| System updater and later system task windows | Utilities | Future consumers of the utility-host boundary; their operation-specific design is out of scope here. |

## Scope

### In Scope

- Add the lazy `ags-utilities` AGS host and a stable shell-to-utilities launch
  path.
- Move About This PC and Force Quit from `ags-bundled` to that host.
- Remove direct Start Menu dependency on utility `globalThis` exports.
- Preserve application/window behavior across Hyprland and Waybar for both
  AGS application identities.
- Update visibility coordination, refresh tooling, documentation, bundle
  configuration, and Stow validation for two UI hosts.
- Make About This PC's expensive command probes non-blocking before it shares
  a host with Force Quit.

### Out Of Scope

- Implementing the System Update Dialog, its runner, privilege model, or
  lifecycle. Those remain owned by `openspec/changes/ags-system-update-dialog`.
- Moving shell components solely to make the two groups symmetrical.
- Creating a separate AGS process for every utility.
- Making Force Quit an independent recovery path. It remains accessible from
  Start Menu only; the request endpoint is not treated as an authorization
  boundary.
- Renaming `ags-bundled` or changing existing shell component request shapes.

## Implementation

### 1. Establish Explicit Host Entry Points

1. Add a small shared host/registry module under `.config/ags/services/` that
   owns component registration and the existing `component + JSON payload`
   request dispatch pattern.
   - Preserve `ready` for an empty request and component-local handlers.
   - Keep each host's registry process-local; do not recreate shared globals
     across processes.
   - Give the utility host a small host-level `ping`/readiness action and a
     `taskbar-visibility` action that only queries components registered in
     that host.
   - Reject missing component names and malformed JSON clearly. Keep the
     initial utility IDs allow-listed rather than exposing arbitrary modules as
     launch targets.

2. Refactor `config-bundled.tsx` to use that shared host registry while keeping
   its current instance name, shell imports, and shell component IDs.
   - Remove `force-quit` and `about-this-pc` declarations, imports, and
     initialization from this entry point.
   - Retain the shell-only taskbar visibility list: Start Menu, Calendar, and
     Audio Mixer.

3. Add `.config/ags/config-utilities.tsx`.
   - Start with `instanceName: "ags-utilities"`.
   - Import and initialize only `force-quit.tsx` and `about-this-pc.tsx`.
   - Register `force-quit` and `about-this-pc` under their existing component
     request APIs, preserving `show`, `hide`, `destroy`, and `is-visible`.
   - Keep `globalThis` only as an internal component-to-host convention during
     this migration; no shell component may use those globals after the split.

4. Update `.config/ags/.fallowrc.json` and `package.json` so static analysis
   and bundle commands have both entry points. Keep shell and utilities bundle
   artifacts distinct.

### 2. Add A Serialized Lazy Utility Launcher

1. Add one executable launcher under `.config/ags/scripts/` as the only
   cross-process utility entry point.
   - Accept a stable utility ID and a fixed action/payload contract, initially
     `force-quit show` and `about-this-pc show`.
   - Map IDs to known component names inside the launcher; never accept a
     caller-supplied entry-point path or arbitrary executable.
   - First request `ping` from `ags-utilities`. If ready, forward the request
     directly without starting another process.

2. Serialize first startup in the current user runtime directory.
   - Use a lock scoped to the active user session, not a fixed shared `/tmp`
     path.
   - After acquiring the lock, check readiness again so simultaneous requests
     do not start competing hosts or lose either action.
   - Start the utility host in a named UWSM user service in the
     session-graphical slice, then wait for its D-Bus `ping` response until one
     bounded deadline expires.
   - Release the lock before forwarding the original request. Return a clear
     failure when readiness is not reached; do not silently drop the action.

3. Start only `ags-bundled` from `.config/ags/start-daemons.sh` at login.
   - Do not pre-start utilities merely to simplify startup.
   - Keep the existing Hyprland readiness and profile reconciliation behavior
     for the shell host.
   - Give the launcher responsibility for utility-host startup rather than
     duplicating the login script's check/spawn/sleep flow.

4. Route Start Menu utility items through the launcher.
   - Preserve the current order: hide Start Menu before opening Force Quit or
     About This PC.
   - Replace `globalThis.ForceQuit.show()` and
     `globalThis.AboutThisPC.show()` in `executeMenuCommand()` with the fixed
     launcher command.
   - Preserve errors in AGS logs when the launcher cannot start or contact the
     utility host.

### 3. Migrate Existing Utility Windows Safely

1. Move About This PC first.
   - Its window is already created on show and destroyed on dismissal, so the
     behavioral migration is low-risk.
   - Change system-information collection to present a loading window and run
     `lspci`/`dmidecode` probes asynchronously with bounded completion and
     cleanup ownership. The current synchronous collection can otherwise block
     Force Quit and every utility-host IPC request on the shared GJS main loop.
   - Ignore late results after close/destroy and release subprocess,
     cancellable, timer, and render resources with the window lifecycle.

2. Move Force Quit second.
   - Preserve singleton/focus behavior and visible-only metric polling.
   - Extend protected-process handling for `ags-utilities` and exclude the
     current process PID unconditionally. Revalidate PID identity immediately
     before the forced-kill fallback so a reused PID cannot be terminated.
   - Keep the shell host, Waybar, Hyprland, lock screen, and relevant AGS
     identities protected by one declarative policy rather than scattered
     string checks.

3. Keep process-local shared services intentionally process-local.
   - Both hosts may independently subscribe to profile state and apply their
     own gaming-opacity CSS. This is expected and must not create a shell
     proxy.
   - Scope utility-only selectors and subscriptions to the utility host's
     actual windows. Ensure no monitor/timer survives host shutdown.

### 4. Preserve Desktop Integration Across Hosts

1. Update `.config/hypr/rules/ags.lua` for the `io.Astal.ags-utilities`
   application class.
   - Apply the same base floating, pinning, border, rounding, and passthrough
     policy intended for AGS application windows.
   - Retain the existing title-specific size and non-resizable rules for About
     This PC and Force Quit.
   - Change utility focus behavior to resolve the calling process's own client
     address through Hyprland IPC rather than relying solely on a title match,
     which can collide with another application.

2. Make a deliberate Waybar policy for `io.Astal.ags-utilities`.
   - Utilities are dialog/task surfaces rather than regular taskbar apps, so
     add the utility application ID to Waybar's `wlr/taskbar.ignore-list` with
     the existing shell instance.
   - Validate that the taskbar does not expose a generic duplicate AGS button.

3. Split taskbar visibility querying by host.
   - Keep `taskbar-visibility` local to each AGS instance.
   - Extend the Hyprland AGS IPC helper to request an explicit instance with a
     strict end-to-end timeout, including its CLI fallback.
   - Update Waybar monitor and shell helpers to query the shell and utilities
     visibility endpoints independently. A missing utility host means no
     utility surface; a timeout or startup race must fail open by keeping
     Waybar visible briefly, not block the monitor loop or hide beneath an
     opening window.
   - Keep the existing shell fallback checks local to the shell instance.

4. Update shell/desktop reset behavior.
   - Replace broad AGS restart assumptions with explicit shutdown of both
     `ags-bundled` and a running `ags-utilities` instance.
   - Start only the shell host after refresh/reset; utilities remain lazy.
   - Do not use a utility-host restart as a reason to stop unrelated
     processes. Future utility work with its own durable backend must define
     that backend's lifecycle separately.

### 5. Align Tooling And Guidance

1. Update `.config/ags/AGENTS.md`, `README.md`,
   `docs/agents/architecture.md`, and `docs/agents/daemon.md`.
   - Replace the inaccurate single-bundled-process guidance with the shell and
     utility host model.
   - Document component ownership, lazy utility startup, instance names,
     request routing, refresh behavior, and the rule for future surfaces.

2. Update `justfile` AGS bundle/refresh recipes.
   - Build both entry points.
   - Stop both UI instances during refresh, restart only the shell host, and
     leave utility startup lazy.

3. Update `devenv.nix` Stow assertions to require the utility entry point and
   launcher, alongside the existing bundled entry point.

4. Update the active System Update Dialog OpenSpec only at its integration
   boundary.
   - Replace its `ags-bundled` registration requirement with
     `ags-utilities` ownership.
   - Add shell-to-utility launch and independent-host availability assertions.
   - Do not revise the updater runner, transaction, privilege, or persistence
     specification as part of this host-split change.

## Validation

### Automated

1. Run TypeScript validation for both AGS entry points after regenerating
   typings only if AGS type generation is required by the changed imports:

   ```bash
   cd .config/ags && ags types && npx tsc --noEmit
   ```

2. Run the existing AGS static check and focused component benchmarks:

   ```bash
   pnpm --dir .config/ags quality
   bash .config/ags/scripts/benchmark/run-benchmarks.sh components
   ```

3. Add focused shell/runtime coverage for the launcher and visibility helper:
   - concurrent first utility requests start exactly one `ags-utilities`
     service and both actions are forwarded;
   - unavailable utility startup returns within the declared deadline;
   - a host with no mapped windows remains reachable through `ping`;
   - shell visibility remains responsive when utilities are absent or frozen;
   - utility visibility keeps Waybar available while a utility surface is
     mapped;
   - Force Quit excludes both AGS process identities and its current PID.

4. Run relevant repository checks for changed shell and Stow wiring:

   ```bash
   devenv test test:shellcheck
   devenv test test:runtime-shell
   devenv test test:stow
   ```

### Live Session Checks

1. Start a fresh graphical session and confirm only `ags-bundled` appears in
   `ags list` before any utility request.
2. Open About This PC from Start Menu. Confirm one `ags-utilities` instance
   starts, its window is floating/pinned/centered, it is absent from Waybar's
   task list, and the Start Menu closes first.
3. Close About This PC and confirm `ags-utilities` remains listed and responds
   to `ping`.
4. Open Force Quit from Start Menu. Confirm it cannot list or terminate either
   AGS host, and verify it remains responsive while About This PC collection is
   pending or slow.
5. Open shell overlays while the utility host is running. Confirm Window
   Switcher, Start Menu, Calendar, and Audio Mixer retain their current timing
   and IPC behavior.
6. Restart AGS UI hosts through the updated recipe. Confirm both hosts load new
   code, only the shell restarts immediately, and utilities remain lazy.

## Success Criteria

- `ags-bundled` contains only shell surfaces and starts at login as before.
- `ags-utilities` starts once on the first utility request, survives zero open
  utility windows, and remains session-persistent.
- About This PC and Force Quit open from Start Menu without shared-process
  globals or a second per-window process.
- Utility failure or restart does not stop shell request handling or shell
  overlays.
- Both application identities have intentional Hyprland, Waybar, visibility,
  process-protection, refresh, bundle, and documentation behavior.
- Future task-oriented windows have a stable destination without expanding the
  login-critical shell bundle.

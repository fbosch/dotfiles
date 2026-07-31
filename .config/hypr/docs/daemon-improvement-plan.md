# Custom Daemon Improvement Plan

This plan brings custom daemons into compliance with
`docs/daemon-maintenance.md`. It prioritizes safe ownership and shutdown before
observability or documentation polish.

## Decisions

- `autostart.lua` is the authoritative persistent-daemon registry.
- `restart-daemons.sh` and `reset-desktop.sh` remain targeted recovery recipes.
  They must document deliberate inclusions and omissions.
- Custom-layout, picture-in-picture, and Waybar monitor gain compatible `ping`
  commands for socket health checks.
- Night light owns and terminates only the `hyprsunset` child it started.
- Waybar monitor remains in UWSM session scope because it coordinates Waybar,
  AGS, SwayNC, and picture-in-picture.
- Do not add a generic daemon framework. Reuse existing feature-local patterns,
  `flock`, shared IPC, JSON, and command helpers.
- Preserve current uncommitted picture-in-picture behavior.

## Phase 1: Ownership Safety

### Custom Layout Drag/Resize

Files:

- `runtime/windows/daemons/custom-layout-drag-resize/`

Changes:

1. Replace the lock-directory model with `flock`, or make its ownership
   kernel-backed.
2. Check a pre-existing socket with `ping` before treating it as stale.
3. Remove a socket or lock only after proving its owner is absent.
4. Clean up only resources created by the current owner.
5. Replace local JSON parsing with `lib.json` without changing geometry logic.

Validation:

- A second daemon cannot replace a live socket.
- A stale socket recovers after its owner exits.
- `start`, `stop`, `quit`, and `ping` remain compatible.
- Drag behavior, animation restoration, and bounded polling are unchanged.

### Picture-In-Picture

Files:

- `runtime/windows/daemons/picture-in-picture.lua`
- `actions/picture-in-picture.lua`
- `autostart.lua`

Changes:

1. Add explicit ownership for `hypr-pip-monitor.sock` before binding it.
2. Add `ping` while retaining drag, resize, and Waybar protocol messages.
3. Replace unconditional socket removal with owner-aware stale recovery.
4. Add prefixed stderr logs for bind failures, recovery, malformed commands,
   IPC failures, and shutdown.
5. Keep normal drag, resize, and Waybar transitions quiet.

Validation:

- A competing process cannot replace a live PiP socket.
- A stale socket recovers safely.
- Drag, resize, Waybar, and `ping` requests retain their behavior.
- Termination cleans up only the current owner's resources.

### Waybar Monitor

Files:

- `runtime/desktop/waybar-monitor.lua`
- `autostart.lua`

Changes:

1. Add ownership for `hypr-waybar-monitor.sock` before binding or removing it.
2. Add `ping` and preserve `show`, `hide`, `hold`, and `release`.
3. Log bind failures, stale recovery, dependency communication failures, and
   shutdown with a feature prefix.
4. Add an autostart comment explaining its approved UWSM session scope.
5. Preserve adaptive cursor polling and hide/show hysteresis.

Validation:

- A live monitor socket survives a competing launch.
- Stale socket recovery works.
- Existing commands and `ping` return defined responses.
- The foreground UWSM process owns the socket and cleans it up on termination.

### Gamescope Clipboard Sync

File:

- `runtime/gaming/gamescope-clipboard-sync.sh`

Changes:

1. Replace the lock directory with `flock`, or add PID-backed liveness checks.
2. Move the log from `/tmp` into a feature path under `$XDG_RUNTIME_DIR`.
3. Track, terminate, and reap the `wl-paste --watch` child on every exit path.
4. Atomically publish the shared last-value file when callback processes can
   read it concurrently.
5. Prefix and rate-limit dependency, lifecycle, and recovery diagnostics.

Validation:

- Concurrent launches produce one owner.
- A stale owner does not prevent startup.
- The watcher is reaped when Gamescope disappears or the daemon exits.
- Missing clipboard tools disable only synchronization.
- Existing clipboard benchmark scenarios still pass.

## Phase 2: Child And State Safety

### Window Capture

Files:

- `runtime/windows/daemons/window-capture/`

Changes:

1. Track capture workers as children of the resident daemon.
2. Record enough worker identity to distinguish a live worker from stale state.
3. Terminate and reap workers during daemon cleanup.
4. Release daemon and worker locks only when they belong to the current owner.
5. Use temporary-file-and-rename publication for shared pending-event and
   coordination files.
6. Name the event reconnect delay and prefix recovery diagnostics.
7. Preserve `daemon`, `refresh-once`, `handle-event`, and `worker` modes.
8. Route persistent startup and recovery through a feature-local shell
   supervisor that terminates and reaps the resident daemon and its worker
   group; keep one-shot modes as direct Lua invocations.

Validation:

- A worker cannot outlive its daemon.
- A live worker's lock is not removed by another process.
- A stale worker marker recovers.
- Concurrent readers never observe a truncated pending event.
- Event reconnects are rate-bounded.

### Night Light

File:

- `runtime/desktop/night-light.sh`

Changes:

1. Check required executables before enabling daemon behavior.
2. Record the PID and process start time of the `hyprsunset` child started by
   night light.
3. Restart, terminate, and reap only that owned child; leave an unowned
   `hyprsunset` instance untouched.
4. Atomically publish override, expiry, and temperature files when commands can
   read them concurrently.
5. Prefix dependency, IPC, restart, and recovery diagnostics.
6. Preserve quiet scheduled transitions and user-triggered notifications.

Validation:

- Missing dependencies disable only night light.
- Failed IPC starts one bounded owned-child recovery path.
- An unrelated `hyprsunset` process remains untouched.
- Termination reaps the owned child.
- Concurrent `toggle` and `status` calls see complete state.

### Window State

Files:

- `runtime/windows/daemons/window-state/window-state-daemon.lua`
- `runtime/windows/daemons/window-state/window-state.sh`

Changes:

1. Treat `hypr-window-state.cache` as shared state and the debounce marker as a
   private crash-recovery marker.
2. Atomically publish shared files and retain direct writes only for private
   markers.
3. Prefix stderr diagnostics and name the event reconnect delay.
4. Log disconnect and retry decisions without logging ordinary window events.
5. Preserve `flock` ownership and generated-rule flow.

Validation:

- Concurrent readers never see partial shared state.
- Socket closure reconnects after a named delay without a tight loop.
- Debounced writes resume after reconnection.
- `rules/window-state.lua` remains generated and unchanged by hand.

## Phase 3: Observability And Isolation

### Gaming Session Watchdog

Files:

- `runtime/gaming/daemons/gaming-session-watchdog/`

Changes:

1. Preserve existing lock, child wait, cleanup, and event handling.
2. Add prefixed, rate-bounded diagnostics for missing or failed `wl-freeze`.
3. Log event reconnect and recovery decisions.
4. Keep ordinary gaming profile and presentation transitions quiet.
5. Treat the configured event read timeout as a quiet recovery cycle; log only
   unexpected disconnects and failed reconnects.

Validation:

- Missing `wl-freeze` does not disable profile monitoring.
- Freeze failures do not terminate the event loop.
- Cleanup unfreezes owned game processes and reaps the Lua child.
- Reconnects use the named delay without repeated log spam.

### Minimized State Daemon

Files:

- `runtime/windows/daemons/minimized-state/`

Changes:

1. Add prefixed startup diagnostics plus rate-bounded disconnect, retry, and
   recovery diagnostics.
2. Preserve event-driven close-window cleanup, locking, and reconnect behavior.
3. Do not change `runtime/windows/minimized-state.lua`; its one-shot locking
   and atomic publication are already compliant.

Validation:

- Close-window cleanup works after event reconnection.
- Retry logs are bounded.
- Concurrent one-shot state operations retain valid JSON.

## Phase 4: Lifecycle Policy

### Autostart

File:

- `autostart.lua`

Changes:

1. Confirm every persistent custom daemon has exactly one UWSM registration.
2. Keep normal custom daemons in background scope.
3. Keep Waybar monitor in session scope with its coordination rationale.
4. Do not register the minimized-state one-shot helper.

Validation:

- The registry includes all persistent custom daemons once.
- No startup command self-backgrounds.
- Each command invokes the correct launcher or LuaJIT interpreter.

### Recovery Recipes

Files:

- `runtime/desktop/restart-daemons.sh`
- `runtime/desktop/reset-desktop.sh`

Changes:

1. State each script's recovery purpose near its header.
2. Document which custom daemons each script intentionally omits and why.
3. Match included commands to autostart's launcher and UWSM scope.
4. Keep both scripts targeted; do not mirror all autostart entries.

Validation:

- Each documented subset matches actual commands.
- A controlled recovery restarts only documented targets.
- Omitted daemons continue running.

Current recovery subsets:

- `restart-daemons.sh` restarts desktop services and their dependent custom
  daemons, while retaining custom-layout drag/resize and Gamescope clipboard
  sync because they do not depend on the restarted UI services.
- `reset-desktop.sh` rebuilds compositor-bound UI workers and retains minimized
  state, picture-in-picture, gaming watchdog, Gamescope clipboard sync, and
  night light because they retain independent state or do not depend on that
  UI rebuild.

## Test Infrastructure

Add focused fixtures under `tests/runtime/` using existing shell and Lua
conventions. Keep fixtures feature-specific rather than adding a framework.

Required coverage:

- Fake Unix sockets for ownership, stale recovery, and protocol checks.
- Temporary runtime directories for lock and atomic-publication tests.
- Controlled children for signal handling and reaping.
- Fake Hyprland event sockets for reconnect tests.
- Stub external commands for dependency-isolation tests.

Current focused fixtures run through `devenv test`:

- `tests/runtime/window_capture_supervisor.sh` verifies worker-group cleanup and
  owned lock removal with a controlled child.
- `tests/runtime/window_capture_ownership.sh` verifies stale worker-marker
  recovery, live-marker preservation, and atomic pending-event reads using fake
  Hyprland and capture commands.
- `tests/runtime/lifecycle_recovery.sh` verifies documented recovery subsets,
  waits, launcher paths, and UWSM scopes with command stubs.
- `tests/runtime/night_light_missing_dependency.sh` verifies that a missing
  `hyprsunset` disables only night light.
- `tests/runtime/night_light_lifecycle.sh` verifies PID-plus-start-time ownership,
  rejection of an unrelated owner without killing its process, one bounded IPC
  restart, and reaping on daemon termination.
- `tests/window_state_rules.lua` verifies generated-rule publication skips
  unchanged content.
- `tests/runtime/window_state_daemon.lua` runs the real window-state daemon
  against fake query and event sockets to verify cache publication and
  reconnect recovery.

## Implementation Order

1. Custom-layout socket ownership.
2. Picture-in-picture socket ownership.
3. Waybar monitor socket ownership.
4. Gamescope clipboard singleton handling.
5. Window-capture worker ownership.
6. Night-light child ownership.
7. Window-state publication and diagnostics.
8. Gaming-watchdog diagnostics.
9. Minimized-state diagnostics.
10. Autostart and recovery-recipe documentation.
11. Focused runtime validation.

The first four slices can proceed in parallel after their feature-local
ownership choices are settled. Window state, gaming watchdog, and minimized
state are independent. Lifecycle documentation follows daemon-local changes.

## Acceptance Criteria

- Every persistent daemon has one authoritative autostart entry.
- A competing process cannot remove a live owner's socket or lock.
- Daemon-owned children terminate and are reaped.
- Shared reader-visible state is atomically published.
- Polling and reconnect intervals are named and bounded.
- Optional dependency failures remain local to their feature.
- Logs identify the daemon, failure, and recovery action.
- Normal compositor and gaming transitions remain quiet.
- Recovery-script inclusions and omissions are documented.
- Waybar monitor's session scope is documented.
- The minimized-state one-shot helper remains behaviorally unchanged.
- Existing uncommitted picture-in-picture behavior is preserved.
- Shell, LuaJIT, focused runtime, Markdownlint, and Hyprland config checks
  pass where the environment supports them.

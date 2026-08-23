# Custom Runtime Daemons

Custom daemons coordinate compositor state, desktop UI, and external tools. Keep
their ownership, lifecycle, and failure behavior explicit so a new daemon does
not create another special case.

## Scope

- A daemon is a persistent helper that owns state, reacts to events, provides a
  local control socket, or manages another long-lived process.
- A bounded action is a one-shot helper, even when it lives beside a daemon. Do
  not add daemon lifecycle machinery to a one-shot command.
- Keep a one-shot mode with its daemon only when both share the same feature
  contract. `window-capture` is an example.

## Ownership And Naming

- Put custom helpers under `runtime/<behavior-area>/`.
- Use a feature directory when a daemon has a launcher, implementation, or
  feature-specific support files. Keep closely related files together instead
  of creating a shared daemon directory.
- Name executable files and commands with hyphens. Use underscores for new
  importable Lua module names.
- Use the kebab-case feature identity for wrappers, supervisor labels, sockets,
  locks, and log prefixes, for example `picture-in-picture`.
- Name a managed launcher `<feature>.sh`. Add the `-daemon` suffix to a
  persistent implementation only when it distinguishes that process from a
  paired one-shot command or feature entry point.
- Keep policy and client exceptions in their declarative source modules.
  Daemons consume the policy; they do not copy exceptions locally.

## Startup And UWSM

- Register every persistent custom daemon in `autostart.lua`. It is the
  authoritative full startup registry.
- Run the managed daemon in the foreground through UWSM. The daemon must not self-background.
- Use `uwsm-app -s b` for ordinary compositor-adjacent background workers.
- Reserve `uwsm-app -s s` for top-level user-session UI services and their
  direct coordinators. Document an exception at its autostart entry.
- A shell launcher should `exec` its long-lived implementation after it has
  established required lock or scheduler state.
- An internal worker may run in the background only when its owning daemon
  bounds and reaps it.

`runtime/desktop/restart-daemons.sh` and
`runtime/desktop/reset-desktop.sh` are targeted recovery recipes, not mirrors
of autostart. When adding a daemon, decide whether each recipe should restart
it and state the reason in that script when it intentionally does not.

## Lua And Shell

- Prefer LuaJIT for long-lived Hyprland-aware behavior, IPC, JSON processing,
  and policy decisions.
- Keep Bash for thin launchers, lock ownership, and external command pipelines
  where shell is materially simpler.
- Use `runtime/lib/daemon-supervisor.sh` for a daemon with a fixed command
  socket, `ping` health check, and supervised LuaJIT child. Keep each wrapper's
  socket path and ordered shutdown commands declarative.
- A daemon without a command socket that directly owns workers needs a
  feature-local shell supervisor. It must parent and reap the resident process,
  terminate owned worker groups on signals, and leave one-shot modes direct.
- Use `runtime.lib.hypr-ipc` for Lua Hyprland queries and event subscriptions.
- Reuse `lib.json`, `lib.command`, `lib.paths`, and other existing helpers
  before adding local parsing, quoting, or path logic.
- Do not add a generic daemon framework without at least two concrete features
  that need the same lifecycle abstraction.

## Singleton Ownership

Any daemon that writes shared state, binds a fixed control socket, or controls a
singleton external process needs an explicit ownership mechanism.

- Prefer `flock` when lock lifetime should follow process lifetime. The kernel
  releases it when the owner exits.
- Use a lock directory only when it contains enough evidence to establish
  liveness, such as a PID, bounded timestamp, or responsive control socket.
- Never remove an existing lock only because it exists. Verify that the owner
  is absent or unresponsive first.
- Clean up owned sockets, lock directories, and child processes on normal exit
  and termination.
- Cleanup must not remove resources owned by a live competing process.
- When a daemon manages an external singleton, record its PID and immutable
  process identity when possible. Never use a global name match to terminate it.

## IPC And Scheduling

- Put feature command sockets, locks, markers, and short-lived caches under `$XDG_RUNTIME_DIR`.
- Treat each command socket as a small feature API. Keep its accepted messages,
  response, owner, and callers obvious in the implementation.
- A daemon with a command socket **MUST** expose a side-effect-free `ping`
  health check that returns exactly `ok`.
- Launchers **MUST** require that response before treating a socket as live.
  Treat timeouts, malformed responses, and `error` responses as failures.
- Run health checks only during startup, restart, recovery, or explicit
  diagnostics. Do not add probes to polling or interaction hot paths.
- Do not add a command socket solely for health checks. A daemon without one
  relies on process ownership, lock state, and reconnect diagnostics instead.
- A health check proves liveness, not readiness. Add a `status` command only
  when callers need to distinguish ready and degraded states.
- Prefer native `hl.on` events for compositor-resident Lua behavior. Use
  Hyprland socket2 events when an external daemon must react to compositor changes.
- Polling is appropriate only when Hyprland has no event, for pointer or drag
  sampling, or for a short convergence period.
- Bound and debounce polling. Use adaptive intervals where interaction rate
  matters, and avoid dispatches when observed state has not changed.
- Reconnect an event socket after failure using a visible, named retry delay.

## State And External Tools

- Keep ephemeral state in `$XDG_RUNTIME_DIR`. Use `/tmp` only as an existing
  fallback when the runtime directory is unavailable.
- Publish files read by another process with a temporary file and rename.
  Direct writes are only for private markers where a partial read has no
  consequence.
- Keep the temporary file in the destination directory so `rename` remains an
  atomic replacement on the same filesystem.
- Keep generated persistent Hyprland data in its designated configuration path,
  not the runtime directory.
- Quote dynamic shell arguments through `lib.command` in Lua or shell-safe
  positional handling in Bash.
- Check required external executables before enabling dependent behavior. An
  optional dependency failure should disable only that feature.
- Keep timeouts, retry delays, polling intervals, debounce windows, and stale
  thresholds as named constants near the owning implementation.

## Logging And Recovery

- Write daemon logs to stderr by default, prefixed with the daemon or feature name.
- Log failures, retries, and recovery decisions. Keep normal transitions quiet.
- Use a separate runtime log only when external tool behavior or event volume
  requires an inspectable history.
- Send desktop notifications only for user-actionable failures or explicit user
  actions.
- Recover local transport failures in the daemon itself. Manual restart scripts
  are a whole-desktop recovery path, not the primary reconnect strategy.

## Test Seams

- Add a bounded one-shot or status mode when the daemon has a useful
  transformation or reconciliation step that can run without its resident event
  loop.
- Do not add artificial command modes to a pure event listener unless there is
  a concrete diagnostic need.
- Where practical, exercise stale ownership, shutdown cleanup, event-socket
  reconnection, atomic publication, and missing optional dependencies.

## Runtime Fixture Portability

- Match each fixture's syntax to its shebang. Use Bash only when the fixture
  declares Bash; generated helpers declared as `sh` must use POSIX shell syntax.
- Test generated helper scripts with the interpreter named in their shebang.
  Do not assume the local `/bin/sh` matches CI.
- Keep failure injection explicit and portable. For example, use `read` with
  input redirection instead of Bash-only shorthand in a `sh` helper.
- When a runtime fixture fails only in CI, inspect the helper interpreter and
  reproduce the helper command with that interpreter before changing daemon
  behavior.

## Adding A Daemon

1. Confirm that the behavior must be persistent rather than a one-shot helper.
2. Place the feature under the appropriate `runtime/<area>/` path.
3. Add one foreground UWSM startup entry in `autostart.lua` and choose its scope.
4. Define singleton ownership, stale-owner validation, runtime paths, and
   termination cleanup.
5. Use shared Hyprland IPC and socket2 events; identify and bound any necessary
   polling.
6. Define the feature socket protocol, including `ping`, expected response,
   timeout, and stale-owner behavior when other helpers need to control it.
7. Publish concurrently consumed state atomically and check external dependencies.
8. Decide whether each targeted recovery script should include the daemon.
9. Add a one-shot or status mode only when it provides a meaningful test or
   diagnostic seam.

## Reviewing A Daemon

1. Trace its startup entry, recovery scripts, on-demand launch paths, and
   user-facing callers.
2. Confirm one live owner controls each shared state file, socket, or external process.
3. Verify stale locks and sockets are not removed while a live owner exists.
4. Verify health checks require their documented response and stay outside hot
   paths.
5. Verify termination reaps children, restores external state, and removes only
   owned resources.
6. Verify event socket failures reconnect without a tight retry loop.
7. Confirm every polling loop has a stated trigger, rate bound, and
   unchanged-state suppression.
8. Confirm shared files cannot expose partial contents to readers.
9. Confirm dynamic shell values are quoted and optional dependency failures
   remain local to the feature.
10. Confirm logs identify the feature, failure, and recovery action.

# Extract the Daemon Event-Loop Helpers

## Problem

Four daemons under `runtime/windows/daemons/` each own a Hyprland event-socket
loop, and each re-implements the same two pieces of it:

| daemon | loop shape | rate-limited log |
| --- | --- | --- |
| `window-state/window-state-daemon.lua` | `socket.select` + poll + debounce | `log_rate_limited` |
| `window-capture/window-capture-daemon.lua` | blocking `receive` | boolean-transition |
| `minimized-state/minimized-state-daemon.lua` | blocking `receive` | `log_diagnostic` |
| `picture-in-picture.lua` | `socket.select` + control socket | none |

`log_rate_limited` (window-state) and `log_diagnostic` (minimized-state) are
the same function under different names: a per-key timestamp table that
suppresses repeats within an interval. The reconnect-with-backoff policy is
mature in window-state (`schedule_event_reconnect`/`reconnect_events`) and
weaker in window-capture and minimized-state.

The loop *shapes* differ — select-multiplexed vs blocking read — so they are
not the extraction target.

## Decision

Two slices; do not unify the loops.

1. **Extract the rate-limited logger.** One module owns the per-key throttle;
   both window-state and minimized-state consume it. (Strong.)
2. **Extract the reconnect-with-backoff policy** from window-state; adopt in
   window-capture and minimized-state. (Worth exploring.)

A single `event_loop.run(on_event)` is rejected: the select-vs-blocking choice
and each loop's extra work (adaptive polling, worker reaping, control-socket
multiplexing) is the implementation, not the interface. Forcing it behind one
seam would produce an interface as wide as three implementations.

## Implementation — slice 1

1. Add `lib/rate_limit.lua`.
   - `new(log, interval_seconds, now)` returns two values: a throttled
     `emit(key, message)` and `reset(key)`.
   - `now` defaults to a lazily-required `socket.gettime`; the parameter exists
     so the throttle is testable without wall-clock timing.
   - `reset(key)` preserves window-state's clear-on-reconnect behavior.
2. Refactor `window-state-daemon.lua`: replace `log_rate_limited` and
   `last_failure_log_at` with `rate_limit.new(log, event_reconnect_log_interval)`;
   replace `last_failure_log_at["event-reconnect"] = nil` with
   `reset_rate_limit("event-reconnect")`.
3. Refactor `minimized-state-daemon.lua`: replace `log_diagnostic` and
   `last_diagnostic_at` with `rate_limit.new(log, diagnostic_interval_seconds)`.
4. Add `tests/rate_limit_spec.lua` covering first-emit, suppression, emit after
   interval, per-key isolation, and reset.

## Implementation — slice 2

1. Add a reconnect helper in `runtime/lib/` owning the connect-fail → backoff →
   rate-limited-log cycle from window-state's `schedule_event_reconnect`/
   `reconnect_events`.
2. Adopt it in window-capture and minimized-state; leave picture-in-picture's
   no-backoff inline reconnect as-is (it cannot block).

## Validation

1. `busted --lua=luajit` full suite green, plus the new `rate_limit_spec`.
2. `stylua --check` clean on changed files.
3. `luac -p` on `hyprland.lua` (unchanged) and syntax-check the two daemons.

## Success Criteria

- The rate-limited throttle has exactly one implementation.
- window-state and minimized-state call the shared module; their log output and
  reconnect-clear behavior are unchanged.
- The four daemons keep their own loop shapes; no loop is forced behind a
  shared seam.

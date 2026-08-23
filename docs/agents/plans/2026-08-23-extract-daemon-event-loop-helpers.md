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

Slice 1 is done. Slice 2 and the scaffolding were investigated and rejected.

1. **Extract the rate-limited logger.** One module owns the per-key throttle;
   both window-state and minimized-state consume it. (Strong.) — done.
2. **Reconnect-with-backoff policy** — rejected after investigation (below).
3. **Daemon scaffolding** (`read_file`/`write_file`/`log`) — rejected; the
   copies have drifted (below).

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

## Rejected — slice 2 and scaffolding

The reconnect policy has no stable seam across the three daemons:

- window-state reconnects non-blocking via a `socket.select` deadline
  (`schedule_event_reconnect`/`reconnect_events` with `event_reconnect_at`).
- window-capture and minimized-state reconnect by `socket.sleep(delay)`, but
  with different `pcall` placement and logging (boolean-transition vs
  rate-limited vs fresh-key).

A shared "reconnect policy" would have to model select-vs-blocking plus
callbacks for connect/idle/disconnect — an interface as wide as the three
implementations.

The scaffolding helpers are also drifted, not copy-paste:

- `read_file`: three variants — `read("*a")` returning `nil` (window-state,
  window-state/rules), `read("*a")` returning `""` (picture-in-picture), and
  `read("*l")` returning `""` (custom-layout-drag-resize).
- `write_file`: two atomic-write strategies — `ffi.C.getpid()` suffix
  (window-capture, cross-process worker safety) vs timestamp+sequence
  (window-state).
- `log`: window-state prefixes `os.date("%H:%M:%S")`; the other three do not.

Each extraction would require normalizing drifted semantics, not deduplicating.
That is a behavior change, not a deepening. Leave them; slice 1 was the clean
win.

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

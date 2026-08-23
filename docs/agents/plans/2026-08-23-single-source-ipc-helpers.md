# Single-Source the AGS and Hyprland IPC Path Helpers

## Problem

Two IPC helper pairs are implemented once per language with no shared source:

- `runtime/lib/ags-ipc.lua` and `runtime/lib/ags-ipc.sh` both fork out to
  `busctl`/`ags` and both re-implement the response parser. The parsers already
  disagree: the Lua one unescapes `\"` and `\\` inside quoted strings, the dash
  one strips quotes only. A payload containing `\"` returns `"` from Lua and
  `\"` from dash.
- `runtime/lib/hypr-ipc.lua` and `runtime/lib/hypr-ipc.sh` both re-derive the
  instance path grammar and the 107-byte Unix-socket limit. The Lua side is
  covered by `tests/hypr_ipc_spec.lua`; the dash side has no coverage.

The fork cost of delegating across the seam was the open question. Measured
with `hyperfine --shell=none`, 300 runs:

```
exec true (baseline)         854.8 µs ±  80.4 µs   ← fork+exec floor
dash + source ags-ipc.sh       1.0 ms ±   0.1 ms
luajit + require ags-ipc       1.0 ms ±   0.1 ms
```

Both interpreters add ~0.15 ms over the ~0.85 ms fork+exec floor. There is no
meaningful difference, so the decision reduces to consumer count and migration
direction, not fork cost.

## Decision

**ags-ipc: Lua owns the interface, pure-Lua.** `runtime/lib/ags-ipc.lua` is the
single implementation with no shell counterpart. The only shell consumer chain
— `waybar-lib.sh`, sourced by `waybar-toggle-smart.sh` — duplicated the
visibility logic that `waybar-monitor.lua` already runs continuously, so it was
deleted rather than given a shim. `window-switcher.lua` now sends `release`
straight to the waybar-monitor control socket.

**hypr-ipc: do not merge.** Merging the path grammar across the language seam
forces one side to spawn the other at runtime (Lua daemons would shell out for
a path, or dash scripts would spawn `luajit`). Neither deletion concentrates
complexity — it just moves it to a process boundary. Pin the contract with a
cross-language parity test instead.

```text
Lua consumers (3)
pip · waybar-monitor · switch-layout
      │ require (in-process)
      ▼
┏━━━━━━━━━━━━━━━━━┓
┃  ags-ipc.lua     ┃   ← single parser + busctl/ags invocation
┗━━━━━━━━┬━━━━━━━━┛
         ▼
  busctl ──> fallback `ags request -i`
```

## Implementation

1. Expose `parse_busctl_string` from `runtime/lib/ags-ipc.lua` so the parser is
   unit-testable. Add `tests/ags_ipc_spec.lua` covering quoted/unquoted
   responses, escape handling, and trailing whitespace.

2. Remove the shell consumer chain.
   - `actions/window-switcher.lua`: replace the `waybar-toggle-smart.sh` call
     with a direct `printf 'release\n' | nc -U <waybar-monitor.sock>` dispatch.
     The daemon's `release` handler clears `super_held` and re-evaluates
     visibility on its next tick.
   - Delete `runtime/desktop/waybar-toggle-smart.sh`,
     `runtime/desktop/waybar-lib.sh`, `runtime/lib/ags-ipc.sh`, and
     `runtime/lib/ags-request.lua`.

3. Add a cross-language parity test for the hypr-ipc path grammar. Drive
   `runtime/lib/hypr-ipc.lua` and `runtime/lib/hypr-ipc.sh` against the same
   input matrix (`XDG_RUNTIME_DIR`, `HYPRLAND_INSTANCE_SIGNATURE`, socket
   name, including the 107-byte boundary) and assert identical results and
   identical rejection behavior.

## Validation

1. `stylua --check` on changed Lua files is clean.
2. `busted --lua=luajit` full suite: 210 successes, 0 failures.
3. `shellcheck` across `.config/hypr/runtime/**/*.sh` is clean.
4. Parity test runs green under `test:runtime-shell`.
5. No remaining references to `waybar-toggle-smart`, `waybar-lib`,
   `ags-request`, or `ags-ipc.sh`.

## Success Criteria

- ags-ipc has exactly one parser and one busctl/ags invocation path, Lua-only.
- No shell consumer of ags-ipc remains; `waybar-monitor.lua` is the single
  owner of waybar visibility.
- hypr-ipc path grammar and the 107-byte rule are pinned by one parity test.
- No Lua daemon gains a subprocess for path derivation; no dash script spawns
  `luajit`.

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

**ags-ipc: Lua owns the interface.** `runtime/lib/ags-ipc.lua` is the single
implementation. A thin `luajit` launcher exposes it to shell callers, and
`runtime/lib/ags-ipc.sh` shrinks to a one-line shim so its only consumer,
`waybar-lib.sh`, is unchanged.

**hypr-ipc: do not merge.** Merging the path grammar across the language seam
forces one side to spawn the other at runtime (Lua daemons would shell out for
a path, or dash scripts would spawn `luajit`). Neither deletion concentrates
complexity — it just moves it to a process boundary. Pin the contract with a
cross-language parity test instead.

```text
Lua consumers (3)                      Shell consumer (1)
pip · waybar-monitor · switch-layout   waybar-lib.sh
      │ require (in-process)                 │
      └──────────────┬───────────────────────┘
                     ▼
          ┏━━━━━━━━━━━━━━━━━┓
          ┃  ags-ipc.lua     ┃   ← single parser + busctl/ags invocation
          ┗━━━━━━━━┬━━━━━━━━┛
                   │ forked once by shell via ags-request.lua
                   ▼
            busctl ──> fallback `ags request -i`
```

## Implementation

1. Keep `runtime/lib/ags-ipc.lua` as the single source of truth. Its parser
   already handles escaped quotes correctly. Extract the parser into a
   pure, unit-testable function if the inline `parse_busctl_string` is hard to
   cover; otherwise leave the module as-is.

2. Add `runtime/lib/ags-request.lua` (executable, `luajit`).
   - Set `package.path` to include the config dir.
   - `require("runtime.lib.ags-ipc")`.
   - Read `component` and `payload` from argv and `instance` from
     `AGS_INSTANCE` (default `ags-bundled`), matching the existing
     `ags_request` signature and env contract.
   - Print the request result.

3. Reduce `runtime/lib/ags-ipc.sh` to a shim:
   - Keep `ags_request()` and have it call
     `luajit "$HOME/.config/hypr/runtime/lib/ags-request.lua" "$1" "$2"`.
   - Delete `ags_busctl_available` and `ags_parse_busctl_string`.

4. Leave `waybar-lib.sh` unchanged; it still calls `ags_request`.

5. Add a cross-language parity test for the hypr-ipc path grammar. Drive
   `runtime/lib/hypr-ipc.lua` and `runtime/lib/hypr-ipc.sh` against the same
   input matrix (`XDG_RUNTIME_DIR`, `HYPRLAND_INSTANCE_SIGNATURE`, socket
   name, including the 107-byte boundary) and assert identical results and
   identical rejection behavior.

## Validation

1. `devenv test:lua` — existing `tests/hypr_ipc_spec.lua` and any new ags-ipc
   parser spec stay green.
2. `devenv test:runtime-shell` — new parity test passes `bash -n` and
   `shellcheck`, then runs green.
3. Confirm `ags_request start-menu '{"action":"is-visible"}'` from a shell
   returns the same value as the pre-change dash implementation against a live
   AGS instance.
4. Confirm `waybar-lib.sh` visibility checks behave unchanged (the escape
   handling is the only intentional difference; it is a fix).

## Success Criteria

- ags-ipc has exactly one parser and one busctl/ags invocation path.
- `waybar-lib.sh` still calls `ags_request` and its output is unchanged.
- hypr-ipc path grammar and the 107-byte rule are pinned by one parity test.
- No Lua daemon gains a subprocess for path derivation; no dash script gains a
  `luajit` spawn for anything but the ags-ipc request.

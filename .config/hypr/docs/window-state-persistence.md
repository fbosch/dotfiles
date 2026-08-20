# Window State Persistence

`rules/window-state-selectors.lua` selects floating clients whose size and
monitor-relative position should be restored when they next open. It is source
data, not a set of live Hyprland rules. The `window-state` daemon captures the
state and generates `rules/window-state.lua`; do not edit that generated file.

This feature has two separate jobs:

1. Capture the geometry of a selected floating client.
2. Restore that geometry with a generated Hyprland window rule.

An upgrade can break either job independently. A generated rule proves capture
worked, but not that the current Hyprland version accepts or applies the rule.

## Data Flow

1. `hyprland.start` runs `autostart.lua`, which starts
   `runtime/windows/daemons/window-state/window-state.sh` under UWSM.
2. The launcher takes an advisory runtime lock and execs the LuaJIT daemon.
3. The daemon queries `j/clients` and `j/monitors` through the instance-scoped
   Hyprland IPC socket and listens for socket2 events.
4. On relevant events, it captures every selected **floating** client. Position
   is stored relative to the client's monitor origin, keyed by selector and
   monitor name.
5. After geometry has been stable for one second, it atomically writes
   `rules/window-state.lua` and runs `hyprctl reload config-only` when the file
   changed.
6. `hyprland.lua` loads those data rules after generated and static rules.
   Hyprland then applies `size` and `move` to a future client that matches both
   the selector and the current monitor workspace.

Closing a tracked window saves immediately. Move and resize events begin a
short, adaptive polling period because their final geometry is not reliably
available at the event boundary.

## Selector Contract

Each entry in `rules/window-state-selectors.lua` has a `matcher`, a `pattern`,
and optionally an `exclude` matcher with one or more patterns.

| Selector matcher | Client JSON field | Generated Lua match key |
| --- | --- | --- |
| `match:class` | `class` | `class` |
| `match:title` | `title` | `title` |
| `match:initial_class` | `initialClass` | `initial_class` |
| `match:initial_title` | `initialTitle` | `initial_title` |

`match:initialClass` and `match:initialTitle` are accepted aliases for the
underscored selector names.

Selectors are considered in declaration order. The first matching selector that
does not match its exclusion wins. An exclusion only rejects that selector, so a
later selector can still capture the client.

Patterns are intended as Hyprland regular expressions. The generated rule
preserves a regex-shaped pattern and anchors a plain literal as `^literal$`.
Capture uses a small conversion to Lua patterns, not Hyprland's regex engine.
Keep selectors simple and anchored, as in `^Bitwarden$`. Do not assume advanced
regex syntax has identical capture and restore semantics.

The Nemo selector is the useful reference: it captures the main Nemo window but
excludes clients whose initial title is `File Operations` or `Preparing`. The
generated rule expresses that exclusion as Hyprland's `negative:(...)` matcher.

## Generated Rule Contract

Each saved selector has independent state per monitor. A generated entry has
this shape:

```lua
{
  matcher = "match:class",
  pattern = "^Bitwarden$",
  monitor = "DP-2", -- metadata and cache identity
  match = {
    class = "^Bitwarden$",
    workspace = "m[DP-2]",
  },
  effects = {
    fullscreen_state = "0 0",
    size = "999 1113",
    move = "300 120",
  },
}
```

`monitor` is not a rule effect. `fullscreen_state = "0 0"` ensures an
application's maximize request cannot override restored windowed geometry. The
daemon does not capture maximized or fullscreen clients, so those temporary
states cannot replace the last windowed geometry. The
`workspace = "m[<monitor>]"` matcher keeps
each monitor's saved geometry local to that monitor. `size` and `move` must stay
space-separated strings because that is the Lua window-rule API contract.

The rule loader converts `effects` into an anonymous `hl.window_rule(...)` call.
Rule order is significant:

1. `rules/generated.lua`
2. Static rules under `rules/`
3. `rules/window-state.lua`

The daemon must request `hyprctl reload config-only` because generated data
files are not watched Lua configuration dependencies.

## Upgrade Debugging

Record the pre-upgrade compositor version and check the active configuration
before testing behavior:

```bash
hyprctl version
hyprctl configerrors
```

Use one configured floating application, resize and move it, wait at least one
second, close it, and then reopen it on the same monitor. Reopening matters:
this feature restores through window rules, not a direct geometry dispatch.

### 1. Confirm The Daemon Is Running

```bash
pgrep -af 'window-state'
journalctl --user -b --no-pager | rg 'window-state'
```

The daemon logs startup, IPC reconnects, poll failures, and failed rule reloads
to stderr. A missing daemon or a failure to connect to `.socket.sock` or
`.socket2.sock` is a capture-path failure.

### 2. Confirm Hyprland Still Reports The Expected Client Schema

Replace `Bitwarden` with the class under test:

```bash
hyprctl -j clients | jq '.[] | select(.class == "Bitwarden") | {
  class, title, initialClass, initialTitle, floating, monitor, at, size
}'
hyprctl -j monitors | jq '.[] | { id, name, x, y }'
```

Capture requires `floating: true`. It also depends on the selected identity
field, monitor id, global `at` coordinates, and `size` array. A renamed JSON
field, changed value type, changed event name, or changed IPC socket protocol is
an upgrade-sensitive daemon contract.

### 3. Confirm Capture Produced A Rule

After the one-second debounce or immediately after closing the client, inspect
the generated output:

```bash
rg -n -C 6 'Bitwarden' ~/.config/hypr/rules/window-state.lua
```

Expected evidence is a matching selector, the monitor metadata, a workspace
matcher such as `m[DP-2]`, and string `size` and `move` effects. No changed rule
after a valid floating client points to selector matching, IPC client data, or
daemon lifecycle. A changed rule without restored geometry points to rule
syntax, reload behavior, or rule application timing.

### 4. Confirm Reload And Rule Application

```bash
hyprctl reload config-only
hyprctl configerrors
hyprctl rollinglog -f
```

Keep `rollinglog` open while reopening the client. Look for Lua load warnings,
unknown window-rule keys, invalid matcher syntax, or a change in window-rule
precedence. The current implementation depends on these Hyprland Lua details:

- `hl.window_rule(...)` accepting `class`, `initial_class`, `initial_title`,
  `workspace`, `size`, and `move`.
- `negative:(...)` retaining its matcher meaning.
- `m[<monitor>]` selecting the monitor workspace while the window rule runs.
- Rules being applied at a point where `move` and `size` can affect a newly
  opened floating client.

## Baseline And Test Coverage

The local baseline is Hyprland `0.55.0`; see `docs/agents/version.md`. Lua
configuration is still a release-sensitive API, so test this workflow after
every Hyprland upgrade rather than treating the generated Lua format as stable.

Offline coverage exercises selector validation, literal and regex rendering,
exclusions, monitor-specific state, atomic writes, daemon event handling, and
reload requests. It does not prove a newer Hyprland release accepts and applies
the generated rule. Run the focused checks before an upgrade and after any
generator change:

```bash
devenv tasks run test:lua
devenv tasks run test:window-state-runtime
```

The live close-and-reopen check is the regression test for the compositor-side
contract.

## Relevant Files

- `rules/window-state-selectors.lua`: writable client-selection policy.
- `runtime/windows/daemons/window-state/window-state.sh`: launcher and lock.
- `runtime/windows/daemons/window-state/window-state-daemon.lua`: IPC, events,
  capture, debounce, persistence, and reload.
- `runtime/windows/daemons/window-state/rules.lua`: selector validation, cache,
  and generated Lua rule rendering.
- `rules/window-state.lua`: generated persistent state; never edit manually.
- `rule-loader.lua` and `hyprland.lua`: generated rule loading and ordering.

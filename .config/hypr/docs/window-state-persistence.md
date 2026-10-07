# Window state persistence

`rules/persistent_position.lua` is the opt-in policy. It declares native
`hl.window_rule(...)` effects only when the plugin adapter is enabled.
`persistent-position` owns saved position, size, initial windowed state, and PiP
placement. It restores them before initial layout. Saving does not rewrite rules,
reload the compositor, or move an already-open window.

## Native path

1. `plugins/persistent_position.lua` loads the installed plugin and checks its API.
2. Configuration loads the durable v2 cache before selected windows map.
3. Completed native drags and explicit keyboard actions capture windowed floating
   geometry. An asynchronous worker coalesces snapshots and writes them atomically.
4. Mapping reads memory only. Static-rule hooks handle initial windowed state and
   saved PiP monitor routing; the pre-layout hook applies size and position.

Native state lives at `$XDG_STATE_HOME/hyprland/persistent-position.state`, or
`~/.local/state/hyprland/persistent-position.state`. Only version 2 is supported.
Invalid or older state is rejected without overwriting it. Legacy generated state
and existing backups are no longer read or migrated.

## Policy

Hyprland owns matching, including multiple `match` fields and `negative:` regexes,
rule precedence, and rule enabled state. The last applicable persistence effect
wins. The `persistent_position:remember` value is the stable state identity;
editing its matcher does not create a new identity. Existing IDs and version-2
state files remain unchanged.

```lua
local persistence = require("plugins.persistent_position")
if not persistence.enabled then
    return
end

hl.window_rule({
    match = {
        class = "^nemo$",
        initial_title = "negative:^(File Operations|Preparing)$",
    },
    ["persistent_position:remember"] = "nemo-main",
})
```

The adapter requires state API v2 and native rule API v1, then calls
`configure(state_path)` before marking persistence enabled. A deferred, failed,
or incompatible load skips the persistence-only declarations. Ordinary window
rules remain active; the loader reports configuration failures without a
selector-based or reload-based fallback.

- Ordinary policies default to independent monitor-relative state for each
  identity and named monitor. `["persistent_position:per_monitor"] = false`
  shares one record across outputs.
- Saved size restores by default and overrides a static size rule.
  `["persistent_position:restore_size"] = false` keeps client-owned size.
  Explicit `move` and `center` still win for ordinary position restoration.
- Ordinary policies restore an initial windowed state by default.
  `["persistent_position:force_windowed"] = false` preserves initial client
  fullscreen intent. Later fullscreen requests remain allowed in either case.
- Fullscreen, maximized, tiled, and excluded windows do not overwrite ordinary
  saved geometry. Programmatic moves need an explicit `capture_focused()` call;
  the plugin does not infer user intent from every geometry notification.

## PiP authority

The PiP placement reducer continues to own snapping, previews, resize anchoring,
and temporary Waybar avoidance. Only an observed accepted placement is sent to
`accept_pip_placement()`. The reply acknowledges in-memory acceptance and queued
persistence, not an fsync completion.

The plugin remembers a corner or free position plus its named monitor. Corners
use final initial window dimensions and a 15-logical-pixel margin, restore the
corresponding corner tag and entry animation, and clear other corner tags. Free
placement restores no corner tag. A missing saved monitor uses normal routing
without discarding the record.

The `["persistent_position:profile"] = "pip"` effect selects global
accepted-placement state, saved-monitor routing, no size restoration, and no
initial-windowed forcing. Its native/browser size policy remains authoritative.
Generic capture never records PiP or temporary Waybar avoidance as a new accepted
placement.

## Upgrade and retirement

Native state API v2 is required. The legacy daemon, its reload publisher, and
the generated window-state loader phase have been removed. PiP sends acceptance
directly to the plugin. Desktop restart/reset scripts no longer start the old
writer.

The persisted-data importer and v1 migration support have been removed. Existing
legacy state and backups remain untouched. Missing or invalid native configuration
reports an error; it never starts a reload-based fallback.

Production rollout was verified with plugin 0.2.0 and 20 selectors. A repeated
secondary-monitor resize produced no rule-file changes or `configreloaded` event,
and the user reported that WoW no longer flickered.

## Validation

The plugin checks build/runtime compatibility and required hook installation,
without a hardcoded supported commit. Build it with
`just check-hyprland-plugins` in the NixOS repository. The native tests cover state
validation, rejection of older formats, secure atomic writes, and worker lifetime.
Dotfiles tests cover guarded native declarations, stable identities, PiP delivery, and the
absence of generated-rule loading in native mode.

Run runtime probes only in a separate nested compositor with private config,
state, and explicitly selected IPC sockets. Covered cases include Wayland and
XWayland size restoration, later fullscreen requests, all PiP corners and free
placement, saved-monitor routing, and missing-monitor fallback. These logical
checks do not establish first-frame pixels or physical-monitor WoW behavior.

The replayable probe is `tests/runtime/native_state_sandbox.py`. Run it from the
repository's devenv shell with `TEST_HYPRLAND_DIR` pointing to the matching
compositor's `bin` directory and `TEST_PLUGIN` to its built `.so`. These explicit
paths prevent the test from loading a different system generation. The probe
creates private temporary state and verifies its sandbox signature before every
control command. It does not simulate pointer input; resize coverage uses the
explicit capture API.

After production rollout, repeat the secondary-monitor resize while observing
`configreloaded`. Success requires both no persistence-driven reload and no WoW
flicker. The old physical-monitor session has not been used for experimental
plugin loading.

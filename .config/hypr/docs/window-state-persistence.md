# Window state persistence

`rules/window-state-selectors.lua` is the opt-in policy. Native state API v2 in
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

Selectors match in declaration order using Hyprland's full-match regex engine.
The first matching, nonexcluded selector wins. Stable selector IDs identify state;
window addresses and process IDs do not. Nemo excludes File Operations and
Preparing windows.

- `per_monitor` defaults to true. Each selector and monitor has an independent
  monitor-relative logical position and size. Global selectors share one record.
- `restore_size` defaults to true. Saved size takes the same precedence as the
  former generated size rule. Explicit `move` and `center` still win for ordinary
  position restoration.
- `force_windowed` defaults to true and affects initial mapping only. A later
  fullscreen request remains allowed.
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

PiP sets `restore_size = false` and `force_windowed = false`: its native/browser
size policy remains authoritative. Generic capture never records PiP or temporary
Waybar avoidance as a new accepted placement.

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

The plugin hooks are pinned to Hyprland `19fb395d`. Build it with
`just check-hyprland-plugins` in the NixOS repository. The native tests cover state
validation, rejection of older formats, secure atomic writes, and worker lifetime.
Dotfiles tests cover selector translation, native ownership, PiP delivery, and the
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

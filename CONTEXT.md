# CONTEXT

Domain vocabulary for this dotfiles repository. Architecture reviews and agents
should use these terms; new concepts named during design work land here.

## Hyprland runtime

- **daemon kit** — `runtime/lib/daemon.lua`. Deep module owning the Hypr IPC
  transport seam, normalized `clients()`/`monitors()` records, the event
  socket, owned one-line control sockets, and atomic file helpers for long-lived
  Lua daemons. Constructed with `daemon.new({ transport = ... })`; tests inject
  in-memory transports and socket factories. Locking deliberately stays in
  shell launchers, not the kit.
- **instance path** — `$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/…`.
  This is the ownership boundary for daemon sockets, locks, and state files;
  all paths derive from it through `runtime/lib/hypr-ipc.{lua,sh}` and must
  respect the Unix socket path-length limit (ADR-0011).
- **control socket** — instance-scoped command channel a daemon serves so
  keybind actions can drive it (e.g. `pip-monitor.sock`).
- **query/dispatch IPC split** — read-only Hyprland queries use the query
  socket and may fall back once to `hyprctl`; state-changing dispatches use
  the explicit IPC path and never silently fall back.
- **monitor role** — logical display identity (`ultrawide`, `portrait`) mapped
  from connector names by `lib/monitor_role.lua`; layouts and policies target
  roles, never connector names.
- **source/derived rule pipeline** — writable policy and selector sources
  generate runtime rule data. Generated outputs are never edited directly,
  and their application order relative to static rules is significant.
- **window-state selectors** — writable source list
  (`rules/window-state-selectors.lua`) describing which floating windows get
  position/size persistence; `rules/window-state.lua` is generated data
  produced by the window-state daemon from captured state.
- **window-state capture** — pure snapshot module
  (`runtime/windows/daemons/window-state/capture.lua`) that turns normalized
  selectors, clients, and monitors into deterministic persisted JSON. The
  window-state daemon owns IPC queries and scheduling.
- **window-state publication** — activation step that merges a stable capture
  into retained selector state, prunes state when selectors change, atomically
  replaces derived rules only when their content changes, and then refreshes
  active rules. Capture and scheduling remain outside this step.
- **stable target identity** — identity used to approve and revalidate a
  window before targeted actions. Prefer stable client IDs, use addresses only
  as a fallback, and never treat broad class/title selectors as sufficient
  proof of identity (ADR-0010).
- **PiP placement** — pure placement reducer for the Picture-in-Picture
  window (`lib/pip_placement.lua`): owns snap geometry, waybar avoidance,
  the client-drag state machine, corner-tag policy, and preview dedup.
  Interface is `place(state, input) → (state, commands)` over plain tables;
  the picture-in-picture daemon is a thin adapter that feeds it IPC data and
  interprets returned commands as dispatches, tags, and preview actions.
- **pointer interaction router** — `lib/window/pointer.lua`. Selects the PiP,
  custom-layout, or native owner for pointer drag/resize presses and returns a
  release callback to `lib.mouse_release`. Hyprland remains the release-event
  owner; keybinds register physical inputs but do not orchestrate adapter state.

## AGS runtime

- **bundled AGS host** — the single login-started `ags-bundled` process. Shell
  surfaces load eagerly; task-oriented utility windows load on demand and are
  routed through `UtilityManager`.
- **bundled host router** — pure request-policy seam
  (`.config/ags/services/component-host-router.ts`) inside the bundled AGS host. It
  normalizes the stable request forms, prefers eager component handlers, and
  delegates utility targets without owning their lazy-load lifecycle. Taskbar
  visibility is synchronous; ordinary utility responses may arrive later.
- **AI Pointer workflow** — the user interaction that begins with pointer
  selection and ends in an answer, cancellation, or failure. Results arriving
  from an earlier interaction are stale and cannot change the current one.

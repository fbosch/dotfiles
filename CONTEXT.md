# CONTEXT

Domain vocabulary for this dotfiles repository. Architecture reviews and agents
should use these terms; new concepts named during design work land here.

## Hyprland runtime

- **daemon kit** — `runtime/lib/daemon.lua`. Deep module owning the Hypr IPC
  transport seam, normalized `clients()`/`monitors()` records, the event
  socket, and atomic file helpers for long-lived Lua daemons. Constructed with
  `daemon.new({ transport = ... })`; tests inject an in-memory transport.
  Locking deliberately stays in shell launchers, not the kit.
- **instance path** — `$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/…`.
  All daemon sockets, locks, and state files derive from it through
  `runtime/lib/hypr-ipc.{lua,sh}` (ADR-0011).
- **control socket** — instance-scoped command channel a daemon serves so
  keybind actions can drive it (e.g. `pip-monitor.sock`).
- **monitor role** — logical display identity (`ultrawide`, `portrait`) mapped
  from connector names by `lib/monitor_role.lua`; layouts and policies target
  roles, never connector names.
- **window-state selectors** — writable source list
  (`rules/window-state-selectors.lua`) describing which floating windows get
  position/size persistence; `rules/window-state.lua` is generated data
  produced by the window-state daemon from captured state.

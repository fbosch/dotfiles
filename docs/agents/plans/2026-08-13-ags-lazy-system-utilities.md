# Load AGS System Utilities Lazily

## Problem

The original two-process proposal gave system utilities a separate AGS host,
but measuring an initialized, windowless `ags-utilities` process added about
40 MiB PSS. The separate GTK/GJS runtime costs more than the ownership and
failure isolation it provides for the current utility set.

## Decision

Keep one login-started `ags-bundled` process. Separate shell and utility
ownership in source structure and lifecycle instead of process boundaries.

```text
ags-bundled
├── Shell components loaded at login
│   ├── Start Menu
│   ├── Window Switcher
│   ├── indicators, Audio Mixer, Calendar, Desktop Clock
│   ├── PiP preview
│   └── confirmation dialogs
│
└── Utility modules loaded on first request
    ├── About This PC
    ├── Force Quit
    └── future task-oriented system windows
```

`services/utility-manager.ts` is the boundary. Shell components request a
stable utility ID through it and do not call utility globals or import utility
components. The manager dynamically imports a utility module, initializes it
once, and routes later AGS requests to the loaded component.

This isolates source ownership, initialization timing, request routing, and
window lifecycle. It does not isolate a fatal GJS/GTK process failure. Long
running or system-mutating work that needs true lifetime isolation belongs in
its own non-GTK process, not another always-warm AGS host.

## Component Ownership

| Component | Ownership | Load behavior |
| --- | --- | --- |
| Start Menu, Window Switcher, indicators, mixer, calendar, clock, PiP, confirmation dialogs | Shell | Import and initialize at login. |
| About This PC, Force Quit | Utilities | Import and initialize on first `open` or direct AGS request. |
| Future task-oriented system windows | Utilities by default | Use the classification rule below. |

A component belongs to utilities when it is an occasional inspect, repair,
configure, or administration task. A component belongs to the shell when it
needs immediate session-start availability, continuous input coordination, or
loss of it impairs routine desktop operation.

## Implementation

1. Keep `config-bundled.tsx` as the only entry point and AGS instance.
   - Import and initialize only shell components at startup.
   - Preserve the existing `ags-bundled` instance name and external shell
     request shapes.

2. Add `services/utility-manager.ts`.
   - Allow-list stable utility IDs.
   - Dynamically import each component on its first open/request.
   - Deduplicate concurrent imports and initialize each component once.
   - Return `false` for an unloaded utility's `is-visible` request without
     importing it.
   - Include loaded utility visibility in the existing taskbar query.

3. Update Start Menu to call `UtilityManager.open()` after hiding itself.
   - Remove direct `globalThis.ForceQuit` and `globalThis.AboutThisPC` calls.
   - Do not let Start Menu know the utility module path or initialization
     details.

4. Keep About This PC non-blocking.
   - Present the window before hardware probes complete.
   - Use cancellable asynchronous subprocess communication with timeouts.
   - Ignore late results after the window is closed.

5. Keep Force Quit protected.
   - Preserve the explicit shell-process exclusions and visible-only metric
     refresh lifecycle.
   - Re-check protected-process behavior when future utility modules add new
     helper processes.

6. Update documentation and tooling to describe one bundled host with lazy
   utility modules. Do not add a second entry point, service, Waybar identity,
   or Hyprland application rule.

## Validation

1. Confirm `ags list` shows only `ags-bundled` before and after utilities are
   opened.
2. Open About This PC and Force Quit from Start Menu. Verify each imports once,
   opens/focuses correctly, and remains addressable through its existing AGS
   component ID.
3. Confirm `taskbar-visibility` reports a loaded visible utility and returns
   `none` when all shell and utility surfaces are hidden.
4. Confirm an unloaded `is-visible` request returns `false` without loading
   the component.
5. Open About This PC with a slow or unavailable hardware probe and verify
   Force Quit and shell IPC remain responsive.
6. Compare PSS before first utility use and after both utilities are loaded;
   retain the single-host design unless measured incremental memory makes the
   benefit insufficient.

## Success Criteria

- The desktop has one AGS GTK/GJS process.
- Utilities are not imported during shell startup.
- Shell code depends only on stable utility IDs.
- First utility use does not add a second process or a second GTK runtime.
- Existing shell request routes and Hyprland/Waybar application identity remain
  unchanged.

# Load AGS System Utilities Lazily

## Problem

The original two-process proposal gave system utilities a separate AGS host,
but measuring an initialized, windowless `ags-utilities` process added about
40 MiB PSS. The separate GTK/GJS runtime costs more than the ownership and
failure isolation it provides for the current utility set.

## Decision

Keep one login-started `ags-bundled` process. Load Force Quit in that process,
but run About This PC in a short-lived `ags-about-this-pc` process. The utility
manager preserves the existing `ags-bundled` request route and supervises the
child process.

The earlier always-running utility host remains rejected because its empty GTK
and GJS runtime costs about 40 MiB PSS. Later measurements showed that opening
About This PC adds about 15 MiB PSS to `ags-bundled` and retains most of it
after the window closes. The short-lived host trades higher memory while the
window is open for reclaiming its complete runtime afterward.

```text
ags-bundled
├── Shell components loaded at login
│   ├── Start Menu
│   ├── Window Switcher
│   ├── indicators, Audio Mixer, Calendar, Desktop Clock
│   ├── PiP preview
│   └── confirmation dialogs
│
├── Utility modules loaded on first request
│   ├── Force Quit
│   └── future task-oriented system windows
│
└── on-demand process routing
    └── ags-about-this-pc → About This PC → exit on close
```

`services/utility-manager.ts` is the boundary. Shell components request a
stable utility ID through it and do not call utility globals or know whether a
utility runs in-process. The manager dynamically imports in-process utilities
or starts and supervises the isolated About This PC host.

This isolates source ownership, initialization timing, request routing, and
window lifecycle. About This PC also gains process-failure and memory-lifetime
isolation. Long-running or system-mutating work still belongs in its own
non-GTK process, not another always-warm AGS host.

## Component Ownership

| Component | Ownership | Load behavior |
| --- | --- | --- |
| Start Menu, Window Switcher, indicators, mixer, calendar, clock, PiP, confirmation dialogs | Shell | Import and initialize at login. |
| Force Quit | Utility | Import and initialize on first `open` or direct AGS request. |
| About This PC | Isolated utility | Start on first `open`, then exit on hide, destroy, or window close. |
| Future task-oriented system windows | Utilities by default | Use the classification rule below. |

A component belongs to utilities when it is an occasional inspect, repair,
configure, or administration task. A component belongs to the shell when it
needs immediate session-start availability, continuous input coordination, or
loss of it impairs routine desktop operation.

## Implementation

1. Keep `config-bundled.tsx` as the only login-started entry point.
   - Import and initialize only shell components at startup.
   - Preserve the existing `ags-bundled` instance name and external shell
     request shapes.

2. Route utilities through `services/utility-manager.ts`.
   - Allow-list stable utility IDs.
   - Dynamically import Force Quit on its first open/request.
   - Start one `ags-about-this-pc` child and deduplicate concurrent opens.
   - Return `false` for an unloaded or stopped utility's `is-visible` request.
   - Include utility visibility in the existing taskbar query.

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

6. Build the About This PC executable at login without starting it.
   - Keep its public request identity behind `ags-bundled`.
   - Do not add a login service, Waybar identity, or Hyprland application rule.
   - Exit the process after hide, destroy, or window close.

## Validation

1. Confirm `ags list` shows only `ags-bundled` while About This PC is closed,
   and also shows `ags-about-this-pc` while its window is open.
2. Open About This PC and Force Quit from Start Menu. Verify each opens and
   remains addressable through its existing `ags-bundled` component ID.
3. Confirm `taskbar-visibility` reports a loaded visible utility and returns
   `none` when all shell and utility surfaces are hidden.
4. Confirm an unloaded `is-visible` request returns `false` without loading
   the component.
5. Open About This PC with a slow or unavailable hardware probe and verify
   Force Quit and shell IPC remain responsive.
6. Compare bundled-host PSS before opening About This PC and after its child
   exits. Also record total PSS while the child is active so the runtime
   overhead remains explicit.

## Success Criteria

- The desktop has one persistent AGS GTK/GJS process.
- About This PC is not imported into the persistent host.
- `ags-about-this-pc` exists only while its window is open or starting.
- Shell code depends only on stable utility IDs.
- Existing shell request routes and Hyprland/Waybar application identity remain
  unchanged.

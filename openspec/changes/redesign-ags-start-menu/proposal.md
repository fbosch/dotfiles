## Why

The current AGS Start Menu is a flat, implementation-led surface that does not provide recent items, safe application recovery, or a focused system-information flow. The design-system prototype established the desired visual direction, but the runtime behavior and data ownership now need one explicit contract before AGS implementation begins.

## What Changes

- Define `StartMenu` as a design-system-first, Kiwi-inspired desktop action surface that AGS mirrors without importing React or Storybook runtime code.
- Add session-scoped recent application history from Hyprland focus events and XBEL-backed recent documents.
- Add grouped Force Quit behavior with graceful-close then bounded forced termination for surviving processes.
- Add an About This PC surface with environment-configured device imagery, chassis-aware Fluent fallback, and local system details.
- Define separate Nix flake and Flatpak update badges, existing update/settings command behavior, and explicit session-action confirmation rules.
- Preserve existing profile controls, bundled AGS registration, Waybar triggering and visibility behavior, and session confirmation scripts.
- Remove `design-system/docs/plans/kiwi-inspired-start-menu.md` after its decisions are captured by this change.

## Capabilities

### New Capabilities

- `ags-start-menu`: A design-system contract and AGS implementation for system actions, recent items, Force Quit, About This PC, update badges, and safe session controls.

### Modified Capabilities

- None.

## Impact

- `design-system/src/components/StartMenu/`, `ForceQuitDialog/`, `AboutThisPC/`, and `Window/`: contract, story, and visual-reference updates.
- `.config/ags/components/start-menu.tsx`: menu structure, actions, recent-item lifecycle, and popup interaction behavior.
- `.config/ags/components/` and `.config/ags/services/`: focused surfaces and runtime services for recent items, Force Quit, and About This PC.
- `.config/ags/config-bundled.tsx` and `.config/waybar/config`: preserve existing component routing and Start Menu trigger behavior, adding registration only where new surfaces require IPC.
- `.config/ags/services/app-icons.ts`: reused as the application icon-resolution boundary; no new icon resolution system is introduced.
- Runtime reads local Hyprland state, `recently-used.xbel`, update caches, `/proc`, `/sys`, and `/etc`; no new package dependency is planned.

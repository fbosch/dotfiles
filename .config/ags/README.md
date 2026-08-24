# AGS Configuration

Bundled AGS configuration for Hyprland desktop UI. The persistent
`ags-bundled` process owns shell surfaces and routes task-oriented utilities.

## Components

The bundled entrypoint imports these components from `components/`:

- `confirm-dialog/` for shutdown, restart, suspend, exit, and window confirmations.
- `volume-indicator/` for volume overlays.
- `keyboard-switcher/` for layout switch feedback.
- `start-menu/index.tsx` for the launcher surface.
- `window-switcher/` for Alt-Tab style window switching and session state.
- `desktop-clock/` for the desktop clock surface.
- `calendar/` for the taskbar calendar.
- `audio-mixer/` for audio controls and backend integration.
- `pip-snap-preview.tsx` for picture-in-picture snap previews.

`start-menu/recent-items-menu.tsx` is owned by the Start Menu feature.
`button.ts` supports multiple components and is not registered as a request target.

## Lazy Utility Components

`services/utility-manager.ts` starts these task-oriented windows only on their
first request:

- `force-quit/` is imported lazily into `ags-bundled`.
- `about-this-pc/` runs as `ags-about-this-pc` and exits when its window closes.

Start Menu and external callers keep using the `ags-bundled` request route.

## Layout

- `config-bundled.tsx` imports shell components and starts AGS with `instanceName: "ags-bundled"`.
- `config-about-this-pc.tsx` is the short-lived system-information entry point.
- `start-daemons.sh` builds both runtime bundles and starts only `ags-bundled`.
- `components/<feature>/` contains vertical feature slices once a component
  needs local policies, child surfaces, state machines, controllers, or tests.
- `services/utility-manager.ts` owns lazy utility loading, process startup, and request routing.
- `start-daemons.sh` starts the bundled process during the desktop session.
- `components/` is the canonical component source.
- `docs/agents/` contains deeper implementation notes for agents.

## Working With It

Start the bundled process manually:

```bash
cd ~/.config/ags && ags run config-bundled.tsx
```

Regenerate AGS typings after AGS updates:

```bash
ags types
```

Use component-specific request formats from the component source or agent docs. The request handler expects a component name followed by that component's payload.

## Validation

For runtime checks, restart the bundled process and confirm Hyprland callers
can still reach shell surfaces. `ags-about-this-pc` should appear only while
its window is open:

```bash
ags quit --instance ags-bundled
~/.config/ags/start-daemons.sh
ags list
```

For benchmark-sensitive changes, use the targeted scripts listed in `AGENTS.md`.

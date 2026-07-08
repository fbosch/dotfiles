# AGS Configuration

Bundled AGS configuration for Hyprland desktop UI. One `ags-bundled` process owns the shell surfaces and routes requests to component handlers.

## Components

The bundled entrypoint imports these components from `lib/`:

- `confirm-dialog.tsx` for shutdown, restart, suspend, and exit confirmations.
- `volume-indicator.tsx` for volume overlays.
- `keyboard-switcher.tsx` for layout switch feedback.
- `start-menu.tsx` for the launcher surface.
- `window-switcher.tsx` for Alt-Tab style window switching.
- `desktop-clock.tsx` for the desktop clock surface.
- `calendar-widget.tsx` for the taskbar calendar.
- `audio-mixer-widget.tsx` for audio controls.

## Layout

- `config-bundled.tsx` imports every component, registers handlers, and starts AGS with `instanceName: "ags-bundled"`.
- `config.tsx` is a stub; bundled mode is the supported path.
- `start-daemons.sh` starts the bundled process during the desktop session.
- `lib/` is the canonical component source.
- `docs/agents/` contains deeper implementation notes for agents.

## Working With It

Start the bundled process manually:

```bash
ags run ~/.config/ags/config-bundled.tsx
```

Regenerate AGS typings after AGS updates:

```bash
ags types
```

Use component-specific request formats from the component source or agent docs. The request handler expects a component name followed by that component's payload.

## Validation

For runtime checks, restart the bundled process and confirm Vicinae/Hyprland callers can still reach the affected surface:

```bash
pkill -f "ags run.*config-bundled"
~/.config/ags/start-daemons.sh
ags list
```

For benchmark-sensitive changes, use the targeted scripts listed in `AGENTS.md`.

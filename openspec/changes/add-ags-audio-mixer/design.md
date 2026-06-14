## Context

The current Waybar volume module left-click opens `wiremix` through the Hyprland taskbar popup system. `wiremix` is a good terminal mixer, but it exposes a TUI rather than a stable machine API for AGS. The Audio Mixer should therefore use AstalWP/WirePlumber directly while keeping the visual contract in `design-system/src/components/AudioMixer/`.

The implementation spans the same two areas as the Calendar Widget: the design system defines the reference shell surface, and AGS implements a GTK widget that mirrors that surface. Storybook stories are reference material only; AGS must not import React or Storybook code. Runtime package changes for AstalWP typelibs belong in the separate `fbosch/nixos` repository.

## Goals / Non-Goals

**Goals:**

- Keep the Audio Mixer visually aligned with existing shell popups: compact, low-copy, and token-based.
- Implement an AGS Audio Mixer Widget in `ags-bundled` that mirrors the design-system reference.
- Use AstalWP as the primary audio backend for event-based updates and controls.
- Cover Wiremix-equivalent primary tabs: Playback, Recording, Output, Input, and Config.
- Support tab switching, volume changes, mute toggles, default speaker/microphone selection, stream target selection, route selection, and profile selection.
- Replace Waybar volume left-click with Audio Mixer Toggle while keeping existing middle/right-click volume behavior unchanged unless explicitly changed later.
- Keep Waybar visible while the Audio Mixer Widget is open.

**Non-Goals:**

- Automating, embedding, or wrapping the `wiremix` TUI.
- Adding Nix package configuration in this dotfiles repository.
- Importing React, Storybook, or design-system runtime code into AGS.
- Per-channel volume editing, search, sorting, peak-meter backend plumbing, or a help screen in the first slice.
- Replacing existing volume keybinds or the compact Volume Change Indicator.

## Decisions

### Design-system first, AGS mirrors the reference

The Audio Mixer starts as a pure design-system reference and AGS mirrors its visual language in GTK. The React component remains a reference contract, not a runtime dependency.

Alternative considered: implement AGS first. Rejected because shell styling would drift from the design system and repeat the Calendar Widget problem this workflow already solved.

### AstalWP is the backend

AstalWP exposes WirePlumber audio objects through GObject properties and signals. It maps directly to speakers, microphones, streams, recorders, devices, routes, profiles, mute, volume, defaults, and stream targets. This fits the repo preference for event-based systems over polling.

Alternative considered: wrap `wiremix`. Rejected because upstream exposes TUI launch/config flags, not a stable JSON/IPC/control API. PTY automation would be fragile and focus-sensitive.

Alternative considered: drive everything with `wpctl`. Rejected as the primary backend because subprocess parsing is brittle and less reactive. `wpctl` may remain a simple fallback for current keybinds.

### UI stays system-like, not web-like

The Audio Mixer should not render explanatory descriptions, item counts, or backend metadata labels just because that data exists. Data is used to choose rows, state, icons, and controls; it is not automatically presented.

Alternative considered: show target/route/profile chips inline. Rejected because it made the component read like a dashboard instead of a shell popup. Detailed routing/profile choices belong in compact row menus.

### Menus hide advanced choices

The first visible surface should show tabs, item rows, volume meters, mute/default affordances, and compact row menus. Stream targets, endpoint routes, and device profiles should live behind row menus rather than always-visible selects.

Alternative considered: show dropdowns in every row. Rejected because it creates visual noise and looks unlike the existing shell components.

### Audio state adapter is isolated

AGS should isolate AstalWP object mapping behind a local adapter that returns display rows and applies actions. Widget rendering should not directly traverse raw GObject objects throughout the component.

Alternative considered: bind raw AstalWP objects directly in every row. Rejected because it spreads backend semantics across UI code and makes fallback/unavailable behavior harder to contain.

### Widget request API mirrors Calendar Widget shape

The Audio Mixer should expose `show`, `hide`, `toggle`, and `is-visible` through `globalThis.AudioMixerWidget`. It should follow the existing bundled component registry pattern used by Calendar Widget.

Alternative considered: launch a separate AGS process. Rejected because this repo runs AGS in bundled mode for performance and shared component lifecycle.

## Risks / Trade-offs

- AstalWP GIR bindings may be missing locally -> degrade without crashing and document required runtime dependency for `fbosch/nixos`.
- AstalWP generated typings may be absent -> run `ags types` only after runtime typelibs are available; do not edit `.config/ags/@girs/` manually.
- React and AGS surfaces can drift -> keep the AGS widget visually aligned to the component source, not Storybook implementation details.
- Stream target/route/profile APIs may expose incomplete or changing lists -> hide unavailable choices and keep row menus resilient to missing data.
- Volume updates can be noisy -> coalesce render updates and avoid polling loops.
- Shared `ags-bundled` process can be affected by backend errors -> catch backend init/action failures and render an empty/unavailable surface instead of throwing.

## Migration Plan

1. Finalize and validate the design-system Audio Mixer reference component and stories.
2. Verify AstalWP runtime and typelib availability in AGS; document package gaps for `fbosch/nixos` if missing.
3. Add the AGS Audio Mixer Widget with unavailable/empty backend state first.
4. Add the AstalWP adapter for lists and event-based updates.
5. Add core interactions: tab switching, volume meter click/drag, mute toggle, default input/output selection.
6. Add row menus for stream target, route, and profile changes.
7. Register the widget in `config-bundled.tsx` and replace Waybar volume left-click with Audio Mixer Toggle.
8. Extend Waybar Visibility Guard to include `audio-mixer-widget is-visible`.
9. Roll back by restoring the previous Waybar volume left-click action to `~/.config/hypr/taskbar/actions.sh wiremix`.

## Open Questions

- Whether live peak meters are worth adding later, because AstalWP does not document a direct peak-meter API.
- Whether row menus should use GTK popovers or a simpler expanded inline row in the first AGS implementation.

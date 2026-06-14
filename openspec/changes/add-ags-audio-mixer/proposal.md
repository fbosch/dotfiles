## Why

The Waybar volume indicator currently opens `wiremix` as a terminal UI. Replace that popup with a lightweight AGS Audio Mixer that matches the local design system and controls PipeWire through AstalWP instead of automating or wrapping `wiremix`.

## What Changes

- Add an `AudioMixer` design-system reference under `design-system/src/components/AudioMixer/` for the visual contract.
- Add minimal Storybook reference stories for playback, output, configuration, and empty states.
- Add an AGS Audio Mixer Widget under `.config/ags/lib/` that mirrors the design-system Audio Mixer contract without importing React or Storybook code.
- Use AstalWP/WirePlumber as the audio backend for speakers, microphones, playback streams, recording streams, routes, profiles, mute state, defaults, and stream targets.
- Replace the Waybar volume left-click `wiremix` launcher with an AGS Audio Mixer Toggle request.
- Keep `wiremix` available as a separate terminal app if explicitly launched, but do not use it as the Audio Mixer backend.
- Extend Waybar visibility guarding so Waybar stays visible while the Audio Mixer Widget is open.
- No per-channel editing, search, sorting, peak-source plumbing, help screen, or terminal/TUI automation in this slice.

## Capabilities

### New Capabilities

- `audio-mixer-widget`: Design-system Audio Mixer surface and AGS widget for PipeWire volume, mute, default-device, route/profile, and stream-target control.

### Modified Capabilities

- None.

## Impact

- `design-system/src/components/AudioMixer/`: New Audio Mixer component, local export, and Storybook references.
- `.config/ags/lib/`: New Audio Mixer Widget and AstalWP-backed audio adapter.
- `.config/ags/config-bundled.tsx`: Register the Audio Mixer Widget in the bundled AGS daemon.
- `.config/waybar/config`: Replace volume left-click `wiremix` action with AGS Audio Mixer Toggle.
- `.config/hypr/runtime/desktop/waybar-lib.sh`: Include Audio Mixer visibility in the Waybar visibility guard.
- Runtime dependency: AstalWP GIR bindings must be available to AGS. System dependency changes belong in the separate `fbosch/nixos` repo, not this dotfiles repo.

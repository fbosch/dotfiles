## 1. Design-System Audio Mixer Contract

- [x] 1.1 Add `design-system/src/components/AudioMixer/AudioMixer.tsx` with pure props, public types, and Tailwind-only styling.
- [x] 1.2 Add `design-system/src/components/AudioMixer/index.ts` local exports for the Audio Mixer component and public types.
- [x] 1.3 Keep the surface compact and shell-like: no explanatory descriptions, item counts, target labels, route labels, or profile labels in the visible row UI.
- [x] 1.4 Add Storybook references for playback, output, configuration, and empty states.
- [x] 1.5 Validate targeted design-system files with Biome and TypeScript checks.

## 2. AstalWP Runtime Discovery

- [ ] 2.1 Verify local AGS runtime can import `gi://AstalWp`.
- [ ] 2.2 If AstalWP GIR bindings are missing, document required package changes for the separate `fbosch/nixos` repo instead of adding Nix config here.
- [ ] 2.3 Regenerate AGS typings with `ags types` only after the runtime typelibs are available.
- [ ] 2.4 Confirm AstalWP exposes speakers, microphones, streams, recorders, devices, routes, and profiles needed by the spec.

## 3. AGS Audio Backend Adapter

- [ ] 3.1 Add a local AGS audio adapter that initializes AstalWP without crashing when unavailable.
- [ ] 3.2 Map AstalWP speakers, microphones, streams, recorders, and devices into display rows for the five Audio Mixer tabs.
- [ ] 3.3 Subscribe to AstalWP property changes and add/remove signals for event-based updates.
- [ ] 3.4 Implement adapter actions for volume, mute, default endpoint, stream target, endpoint route, and device profile changes.
- [ ] 3.5 Clamp volume values to the backend-supported range and ignore unavailable route/profile/target choices safely.

## 4. AGS Audio Mixer Widget Shell

- [ ] 4.1 Add `.config/ags/lib/audio-mixer-widget.tsx` with lazy window creation and the `globalThis.AudioMixerWidget` component contract.
- [ ] 4.2 Mirror the design-system Audio Mixer surface in GTK without importing React, Storybook stories, or design-system runtime code.
- [ ] 4.3 Implement request actions: `show`, `hide`, `toggle`, and `is-visible`.
- [ ] 4.4 Anchor the widget near the Waybar volume indicator on the Trigger Monitor, with default-monitor fallback.
- [ ] 4.5 Implement Escape and outside-click dismissal.
- [ ] 4.6 Render an empty or unavailable surface when AstalWP is unavailable.

## 5. Audio Mixer Interactions

- [ ] 5.1 Implement tab switching in the AGS widget.
- [ ] 5.2 Implement volume meter click or drag for volume changes.
- [ ] 5.3 Implement mute toggle from each row.
- [ ] 5.4 Implement default endpoint selection for Output and Input rows.
- [ ] 5.5 Implement compact row menus or equivalent disclosure for stream target selection.
- [ ] 5.6 Implement compact row menus or equivalent disclosure for endpoint route and device profile selection.
- [ ] 5.7 Ensure advanced row menus do not make target, route, or profile labels always visible in the main row.

## 6. Bundled AGS Wiring

- [ ] 6.1 Add `AudioMixerWidget` to `.config/ags/config-bundled.tsx` global declarations.
- [ ] 6.2 Import `./lib/audio-mixer-widget.tsx` in `.config/ags/config-bundled.tsx`.
- [ ] 6.3 Initialize and register `audio-mixer-widget` in the bundled component registry.
- [ ] 6.4 Ensure backend initialization failures do not prevent other bundled components from loading.

## 7. Waybar Integration

- [ ] 7.1 Replace `.config/waybar/config` volume `on-click` `wiremix` taskbar action with `ags request -i ags-bundled audio-mixer-widget '{"action":"toggle"}'`.
- [ ] 7.2 Keep `.config/waybar/config` volume middle/right-click behavior unchanged unless implementation discovery requires otherwise.
- [ ] 7.3 Update `.config/hypr/runtime/desktop/waybar-lib.sh` to query `audio-mixer-widget` `is-visible`.
- [ ] 7.4 Ensure Waybar stays visible when start menu, SwayNC, taskbar apps, Calendar Widget, or Audio Mixer Widget are visible.
- [ ] 7.5 Leave `wiremix` available as a separately launched terminal mixer, but remove it from the Waybar volume left-click path.

## 8. Validation

- [ ] 8.1 Run `stow -n .` from the dotfiles repo root.
- [ ] 8.2 Run targeted design-system checks for `src/components/AudioMixer` after any visual contract changes.
- [ ] 8.3 Run `pnpm build-storybook` from `design-system/` after Storybook changes.
- [ ] 8.4 Verify `ags request -i ags-bundled audio-mixer-widget '{"action":"is-visible"}'` returns a non-crashing response.
- [ ] 8.5 Verify Waybar volume left-click toggles the Audio Mixer Widget.
- [ ] 8.6 Verify volume, mute, default endpoint, stream target, route, and profile actions update backend state when AstalWP is available.
- [ ] 8.7 Verify the widget degrades safely when AstalWP is unavailable.

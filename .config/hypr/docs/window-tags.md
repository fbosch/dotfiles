# Window Tags

Window tags are policy contracts shared by rules and runtime helpers. Define
reusable policy names in `lib/window_tags.lua`; keep feature-owned tags with the
feature that manages them.

Hyprland reports tags assigned by static window rules with a trailing `*`.
Consumers must treat `name` and `name*` as the same tag. Use
`window_tags.has()` for shared policy tags instead of matching raw values.

## Registry

### `non-resizable`

- Owner: `lib/window_tags.lua`
- Purpose: marks fixed-size windows that custom drag-resize must ignore.
- Producers: title-specific rules in `rules/ags.lua` for Force Quit and About
  This PC.
- Consumer: the native custom-layout resize plugin, configured by
  `lib/window/custom_layout.lua`.

### `passthrough-exempt`

- Owner: `lib/window_tags.lua`
- Purpose: prevents pass-through bindings from redirecting the active window's
  input to another client.
- Producer: the AGS class rule in `rules/ags.lua`.
- Consumer: the FreeRDP pass-through bind in `keybinds.lua`.

### `intentionally-frozen`

- Owner: `lib/window_tags.lua`
- Purpose: marks every mapped window of a game client while the gaming watchdog
  intentionally pauses its process with `wl-freeze`.
- Producer: `runtime/gaming/daemons/gaming-session-watchdog`.
- Consumer: the `anr-tag-ignore` plugin. Its
  `plugin.anr_tag_ignore.ignored_tags` setting clears missed pings and
  suppresses the dialog only when every mapped window for the client has an
  ignored tag.

### Picture-In-Picture Corners

- Tags: `pip-top-left`, `pip-top-right`, `pip-bottom-left`, and
  `pip-bottom-right`.
- Owner: `lib/picture_in_picture.lua`.
- Purpose: records the selected picture-in-picture corner.
- Consumer: the picture-in-picture runtime.

## Adding A Tag

1. Use a stable kebab-case name describing policy rather than a specific
   application.
2. Put cross-module policy tags in `lib/window_tags.lua`; keep feature-local
   state tags in the owning feature module.
3. Add the tag to this registry with its owner and consumers.
4. Add focused coverage for matching behavior when runtime behavior depends on
   the tag.

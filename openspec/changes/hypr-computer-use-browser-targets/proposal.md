## Why

`hypr-computer-use` can see browser windows, but it cannot yet identify the user's default browser, resolve browser metadata, or report which browser-control paths are realistic. Browser targeting should be browser-agnostic first so the plugin does not duplicate Chrome DevTools MCP or assume every browser supports CDP.

## What Changes

- Add read-only browser target discovery based on XDG default browser settings and desktop entries.
- Resolve browser `.desktop` metadata from XDG data directories, including Flatpak export paths exposed through `XDG_DATA_DIRS`.
- Normalize browser identity into a stable metadata contract for matching visible Hyprland clients.
- Report browser target matches and available control/capture capabilities without launching browsers or mutating browser state.
- Add browser-target evidence records linked to the existing read-only visibility boundary.
- Keep URL opening, DOM automation, form filling, profile mutation, forced remote debugging, and browser-specific control adapters out of this change.

## Capabilities

### New Capabilities

- `hypr-computer-use-browser-targets`: Read-only browser default discovery, desktop entry resolution, Hyprland browser window matching, and capability reporting.

### Modified Capabilities

- None.

## Impact

- Extends `.config/opencode/plugins/hypr-computer-use/` with browser discovery and target matching modules.
- Extends the existing `hypr_computer_use_readonly` tool with browser-target modes.
- Uses existing XDG files, desktop entries, Flatpak exports, and Hyprland state; it does not install packages or add browser automation dependencies.
- Preserves the existing read-only safety boundary.

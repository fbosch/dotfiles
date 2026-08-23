# Custom Layout Pointer Migration

The custom layout resize interaction is split across repositories:

- `~/nixos` owns the Hyprland plugin package and session variable.
- `~/dotfiles` owns the Lua layout policy, keybind lifecycle, and compatibility fallback.

The native plugin is intentionally narrow. It forwards compositor pointer motion
to Lua only while Lua has enabled an interaction. Lua remains authoritative for
target selection, resize axis and edge, non-resizable tags, layout messages,
ratio persistence, and animation restoration.

## Compatibility Contract

The dotfiles integration checks for
`hl.plugin.custom_layout_pointer.start` and `.stop` at load time.

- When available, right-drag resizing uses the native
  `custom_layout_pointer.motion` event.
- When unavailable, it uses the existing
  `custom-layout-drag-resize` daemon and control protocol without changing their
  behavior.
- The daemon remains in autostart during the compatibility window. It stays idle
  when the plugin path is selected, but keeps rollback independent of repository
  merge order.

This allows either repository to update first:

- New NixOS with old dotfiles: the plugin is installed but unused.
- New dotfiles with old NixOS: the daemon remains the active implementation.
- New NixOS with new dotfiles: the plugin path is selected automatically.

## Rollout

### 1. Package and expose the plugin

Merge and deploy the NixOS change that:

- builds `hyprland-plugins/custom-layout-pointer` against the configured
  Hyprland package;
- installs it in `environment.systemPackages`;
- exports `HYPR_CUSTOM_LAYOUT_POINTER_PLUGIN` with the plugin store path.

The plugin rejects a mismatched Hyprland commit rather than loading against an
incompatible ABI.

### 2. Enable the dotfiles consumer

Merge this dotfiles change and reload Hyprland. The loader reads
`HYPR_CUSTOM_LAYOUT_POINTER_PLUGIN`, loads the plugin before keybind modules, and
registers the Lua motion handler.

The existing daemon files, launcher, tests, and recovery integration remain
unchanged in this phase.

### 3. Validate the native path

On each Hyprland host:

1. Run `hyprctl configerrors`; plugin load and event registration must not add an
   error.
2. Right-drag a tiled window in `lua:ultrawide_master`; the selected boundary
   must track horizontal pointer motion.
3. Right-drag a tiled window in `lua:portrait_rows`; the selected boundary must
   track vertical pointer motion.
4. Verify an ultrawide layout used on the portrait monitor follows the vertical
   axis.
5. Verify overlapping floating windows still receive native floating resize
   instead of resizing the tiled window behind them.
6. Verify `non-resizable` tagged windows remain unchanged.
7. Release the mouse and reload Hyprland; the final ratio must remain persisted.
8. Verify normal layouts and `SHIFT` aspect-ratio resize remain unchanged.

Keep the compatibility fallback for at least one complete NixOS and dotfiles
update cycle across every target host.

## Fallback Removal

Remove the daemon only after all target hosts satisfy these conditions:

- `HYPR_CUSTOM_LAYOUT_POINTER_PLUGIN` is present in the session;
- `hyprctl configerrors` is clean after login and reload;
- the validation matrix above passes on portrait and ultrawide layouts;
- no host still needs to run a dotfiles revision predating the plugin consumer.

The cleanup change should remove, in one vertical slice:

- `runtime/windows/daemons/custom-layout-drag-resize/`;
- its `autostart.lua` entry and reset/recovery handling;
- fallback imports and command dispatches from `lib/window/custom_layout.lua`;
- daemon protocol and lifecycle tests that no longer describe live behavior;
- daemon documentation references.

Do not remove the fallback in the packaging or consumer PR. That would make
cross-repository update order significant and violate the independent-update
contract.

## Rollback

Revert or disable the NixOS plugin exposure and start a new Hyprland session.
The dotfiles capability check will select the existing daemon automatically. No
persisted layout ratio or ordering format changes are part of this migration.

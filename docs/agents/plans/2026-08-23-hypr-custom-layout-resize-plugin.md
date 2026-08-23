# Hyprland custom-layout resize plugin migration

## Outcome

Move the custom-layout mouse resize mechanism into a Hyprland plugin and delete
the external polling daemon. Keep only configuration policy and animation
restoration in dotfiles Lua.

No ratio, ordering, workspace, or keybinding format changes are involved.

## Ownership boundary

- `~/nixos` owns the ABI-coupled C++ plugin, exact-Hyprland build, installed
  library, and `HYPR_CUSTOM_LAYOUT_RESIZE_PLUGIN` session variable.
- `~/dotfiles` owns plugin loading and the small policy adapter: custom layout
  names, portrait monitor role, the `non-resizable` tag, and animation restore.
- The plugin owns pointer hit-testing, target focus, edge selection, refresh-rate
  throttling, resize message construction, final pointer sampling, and
  `save-resize`.

This follows the same package boundary as the existing local Hyprland plugins
without moving the Lua layout algorithms themselves into C++.

## Deployment order

### 1. Merge and deploy `fbosch/nixos#215`

Rebuild the desktop host and start a fresh Hyprland session so the exact-version
plugin is installed and `HYPR_CUSTOM_LAYOUT_RESIZE_PLUGIN` is present.

Do not merge the dotfiles migration until the NixOS build succeeds.

### 2. Merge `fbosch/dotfiles#4`

The dotfiles change loads the plugin and removes the superseded implementation:

- the LuaJIT resize daemon;
- its shell supervisor and socket control protocol;
- daemon autostart and reset lifecycle wiring; and
- protocol-specific tests.

The right-mouse binding and layout-side `resize-x-at`, `resize-y-at`, and
`save-resize` messages remain unchanged.

## Validation

Repository checks:

```bash
# ~/nixos
just build-pc
just lint

# ~/dotfiles
devenv tasks run test:lua
devenv tasks run test:lua-quality:hyprland
devenv tasks run test:runtime-shell
```

After deployment:

1. Confirm `hyprctl configerrors` is empty.
2. Right-drag `ultrawide_master`; resizing must follow the pointer horizontally.
3. Repeat on `portrait_rows`; resizing must be vertical.
4. Verify `ultrawide_master` on the portrait monitor also resizes vertically.
5. Start a resize while the pointer is outside the focused tile and confirm the
   window under the pointer becomes the target as before.
6. Confirm floating and `non-resizable` targets do not resize.
7. Release after a fast final pointer movement and verify the final geometry is
   retained after layout recalculation and reload.
8. Confirm no `custom-layout-drag-resize` process, socket, PID file, or sequence
   file is created.
9. Run the desktop reset path and repeat a resize.

## Rollback

If live validation fails, revert `fbosch/dotfiles#4` first. That restores the
previous daemon implementation without changing persisted layout state. The
NixOS plugin package can remain installed while investigating or be reverted
separately.

Because the layout algorithms and their persistence formats are unchanged,
rollback does not require migrating ratio/order files or changing keybindings.

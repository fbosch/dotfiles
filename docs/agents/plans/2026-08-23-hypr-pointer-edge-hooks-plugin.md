# Native pointer edge hooks for Waybar

## Goal

Replace cursor-position and monitor-geometry polling in the Waybar visibility controller with native Hyprland pointer-zone transitions, while keeping desktop policy outside the compositor.

## Boundary

The `pointer-edge-hooks` plugin owns only compositor-local mechanics:

- read native pointer motion;
- resolve the logical monitor under the pointer;
- classify distance from that monitor's bottom edge as `show`, `neutral`, or `hide`;
- emit a Lua event only when the zone or monitor changes.

Dotfiles continue to own:

- 200 ms show and 300 ms hide delays;
- gaming-workspace suppression;
- AGS and SwayNC visibility guards;
- Waybar process signals;
- PiP reposition notifications;
- Super-key hold/release behavior.

## Deployment order

1. Merge and deploy the NixOS plugin PR.
2. Rebuild the desktop host and start a fresh Hyprland session.
3. Verify `HYPR_POINTER_EDGE_HOOKS_PLUGIN` resolves to `libpointer-edge-hooks.so`.
4. Merge the dotfiles integration PR.
5. Reload Hyprland and restart the Waybar monitor controller.

The dotfiles integration intentionally has no cursor-polling fallback. Keeping two implementations would duplicate the interaction state machine and obscure failures.

## Live verification

- Moving the pointer into the bottom 20 px shows Waybar after about 200 ms.
- Leaving the bottom 60 px hides Waybar after about 300 ms.
- Moving between `show`, `neutral`, and `hide` zones cancels pending transitions correctly.
- Waybar does not auto-show on the gaming workspace.
- Waybar remains visible while an AGS taskbar component or SwayNC is open.
- Super hold/release behavior is unchanged.
- PiP windows still move when Waybar is shown or hidden.
- `hyprctl configerrors` is empty.
- The Waybar monitor process no longer issues `cursorpos` or `j/monitors` requests.

## Rollback

Revert the dotfiles PR first to restore cursor polling, then revert the NixOS plugin PR. No persisted data or configuration format changes are involved.

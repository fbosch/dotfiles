# Hyprland Quick Rule

Apply common Hyprland window rules from Vicinae after selecting a window with `hyprprop`.

## What It Changes

- Generated rules are written to `~/.config/hypr/rules/generated.lua`.
- Window-state selectors are appended to `~/.config/hypr/rules/window-state-selectors.lua`.
- Snapshot state writes current monitor-relative size and position to `~/.config/hypr/rules/window-state.lua`.
- Hyprland config is reloaded after applying a rule.

## Requirements

- Hyprland.
- `hyprprop` on `PATH`.

## Usage

1. Run `Apply Quick Window Rule` from Vicinae.
2. Select a Hyprland window.
3. Choose the selector field: `class`, `initial_class`, `title`, or `initial_title`.
4. Choose a profile and apply it.

## Profile Groups

- Floating and positioning profiles.
- Fullscreen and picture-in-picture profiles.
- Appearance profiles for decorations, borders, shadows, opacity, and animation behavior.
- Specialized profiles for games, dialogs, utility windows, and file managers.
- Persistence profiles for remembered or snapshotted window state.

## Keybindings

- `Enter` applies the selected profile.
- `Cmd+P` previews the generated rules.
- `Cmd+R` repeats window selection.

## Development

```bash
pnpm install
pnpm run dev
pnpm run lint
pnpm run build
```

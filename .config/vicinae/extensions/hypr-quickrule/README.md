# Hyprland Quick Rule

Apply common Hyprland window rules from Vicinae after selecting a window with `hyprprop`.

## What It Changes

- Generated rules are written to `~/.config/hypr/rules/generated.lua`.
- Persistence profiles append guarded native window rules to `~/.config/hypr/rules/persistent_position.lua`; existing hand-written rules and comments remain intact.
- The native persistence plugin captures floating geometry when tracked windows move or resize. Quickrule does not capture geometry itself.
- Hyprland config is reloaded after adding a rule; repeated persistence matches do not reload it.

Quickrule appends to guarded literal declarations. If the module uses computed
expressions or assigned rule handles, edit it manually; Quickrule refuses the
operation without changing the file.

## Requirements

- Hyprland.
- `hyprprop` on `PATH`.
- For persistence profiles: a matching `persistent-position` plugin with native rule API v1.

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
- Persistence profiles for class-based or selected-field tracking.

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

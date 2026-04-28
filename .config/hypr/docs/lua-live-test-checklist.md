# Hyprland Lua Live Test Checklist

Lua testing now uses `.config/hypr/hyprland.lua`. Remove or rename it to roll back to `.config/hypr/hyprland.conf`.

## Before Switching

Run from repo root:

```bash
lua .config/hypr/hyprland.lua
```

Expected output:

```text
no output
```

Known staged gaps:

- Namespace-specific layer animation timing/curve overrides from `animations.conf` are not fully expressible in the current Lua API.
- Mouse binds are staged with upstream-example syntax, but current source does not appear to wire `opts.mouse` into keybinds.
- `resizewindow 1` has no confirmed Lua equivalent.

## Activate Lua Temporarily

Restart Hyprland while `.config/hypr/hyprland.lua` exists. Do not rely on reload to switch parser modes; config selection happens at startup.

## Immediate Checks

After restart:

```bash
hyprctl configerrors
hyprctl monitors
hyprctl workspaces
hyprctl layers
hyprctl clients
```

Verify:

- No config errors.
- `rvn-pc` monitor layout matches the previous `monitors.conf` behavior.
- Workspace `1` and `10` stay on `DP-2`.
- Workspace rules from `rules.conf` still affect layouts.
- Generated quickrules and window-state rules still apply in order.
- Layer rules apply to Waybar, Vicinae, Rofi, SwayNC, SwayOSD, and AGS namespaces.

## Behavior Checks

Keybinds:

- `SUPER+Q`, `SUPER+B`, `SUPER+E`, `SUPER+R` launch expected apps.
- `SUPER+1..0` switches workspaces.
- `SUPER+SHIFT+1..0` moves windows to workspaces.
- `SUPER+F` maximizes; `SUPER+CTRL+F` toggles fullscreen.
- `SUPER+Escape` enters passthrough; `SUPER+Escape` exits it.
- Media and brightness keys work while locked/repeating where expected.
- Mouse move/resize binds are specifically checked and recorded, because they are a known Lua API risk.

Autostart:

- `hypridle`, `vicinae server`, `atuin daemon`, `foot --server`, `swayosd-server`, and Hypr scripts started once.
- Autostart commands do not rerun on config reload.

Generated state:

- `hypr-quickrule` still writes Lua generated rules and reloads when expected.
- `window-state.sh` still writes `rules/window-state.lua` and selector data.

## Rollback

If behavior is wrong, remove the live Lua entrypoint and restart Hyprland:

```bash
rm ~/.config/hypr/hyprland.lua
```

Hyprland will load `.config/hypr/hyprland.conf` again on next startup.

Keep `.config/hypr/hyprland.lua` under version control while Lua remains the active test path.

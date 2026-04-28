# Hyprland Lua Live Test Checklist

Live config remains `.config/hypr/hyprland.conf`. Do not create `.config/hypr/hyprland.lua` except during an explicit live Lua test window.

## Before Switching

Run from repo root:

```bash
lua .config/hypr/lua/_migration/check-staged-parity.lua /home/fbb/dotfiles
lua .config/hypr/lua/_migration/audit-source-graph.lua /home/fbb/dotfiles
lua .config/hypr/hyprland.staged.lua
```

Expected output:

```text
staged Hypr Lua parity ok
known skipped layer animations: 6
known keybind gaps: 3
hypr source graph audit ok
```

Known staged gaps:

- Namespace-specific layer animation timing/curve overrides from `animations.conf` are not fully expressible in the current Lua API.
- Mouse binds are staged with upstream-example syntax, but current source does not appear to wire `opts.mouse` into keybinds.
- `resizewindow 1` has no confirmed Lua equivalent.

## Activate Lua Temporarily

Only when ready to restart Hyprland into Lua config:

```bash
cp ~/.config/hypr/hyprland.staged.lua ~/.config/hypr/hyprland.lua
```

Then restart Hyprland. Do not rely on reload to switch parser modes; config selection happens at startup.

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
- `window-state.sh` still writes `lua/rules/window-state.lua` and `.conf` compatibility output.

## Rollback

If behavior is wrong, remove the live Lua entrypoint and restart Hyprland:

```bash
rm ~/.config/hypr/hyprland.lua
```

Hyprland will load `.config/hypr/hyprland.conf` again on next startup.

Do not delete `.config/hypr/hyprland.staged.lua`; it is the staged migration source.

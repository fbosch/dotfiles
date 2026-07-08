# Hyprland Config

Lua-first Hyprland configuration with runtime helpers for window rules, session actions, profiles, capture, startup, and desktop state.

## Layout

- `hyprland.lua` is the compositor entrypoint.
- `base.lua`, `programs.lua`, `monitors.lua`, `keybinds.lua`, `animations.lua`, `environment.lua`, `appearance.lua`, `input.lua`, and `autostart.lua` hold the main config groups.
- `layouts/` contains custom layout modules.
- `rules/` contains static layer, workspace, window, generated, and window-state rule data.
- `rule-loader.lua` applies generated and window-state rule phases in the required order.
- `runtime/` contains shell and Lua helpers invoked by binds, daemons, and startup scripts.
- `lib/` contains shared Lua helpers used by runtime scripts.
- `legacy/hyprland-conf/` is rollback/reference material for the old hyprlang setup.

## Rule Flow

Window rules are applied in this order:

1. Generated rules from `rules/generated.lua`.
2. Static rules from `rules/`.
3. Window-state rules from `rules/window-state.lua`.

Edit `rules/window-state-selectors.lua` when changing which windows should persist size and position. Do not edit generated rule outputs directly.

## Local Setup

Create `hyprpaper.conf` from `hyprpaper.conf.example` when wallpaper config is needed locally.

Audio feedback files live next to the config: `bootup.ogg`, `warn.mp3`, and `warn.ogg`.

## Validation

After `.conf` changes, run:

```bash
hyprctl configerrors
```

Use `hyprctl reload` when you need to apply and observe the change in the current session.

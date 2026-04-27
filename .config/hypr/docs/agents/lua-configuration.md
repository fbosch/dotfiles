# Hyprland Lua Configuration

Local reference for migrating this repo from hyprlang `.conf` files to Hyprland Lua config.

## Scope

- Upstream basis: Hyprland `main` after Lua config PR #13817.
- Local live config remains `.config/hypr/hyprland.conf` until Lua parity is ready.
- Local staged entrypoint is `.config/hypr/hyprland.staged.lua`; do not rename it to `hyprland.lua` until ready to test a live Lua session.
- Target static-rule migration excludes generated outputs: `.config/hypr/generated-rules.conf` and `.config/hypr/lua/rules/window-state.lua`.

## Entrypoint Behavior

- Hyprland uses Lua when `hyprland.lua` exists next to the regular `.conf` config.
- Entrypoint selection happens at startup; do not expect to switch between `.conf` and Lua at runtime.
- Explicit config paths are selected by extension: `.lua` uses the Lua config manager, other extensions use the legacy hyprlang manager.
- No source-backed Lua API was found for sourcing existing hyprlang `.conf` files from Lua. Treat live Lua migration as replacing the active config graph, not mixing both parsers.
- Under Lua config, `hyprctl keyword` is legacy-only; use Lua `eval` support where available.

Sources:

- https://github.com/hyprwm/Hyprland/pull/13817
- https://github.com/hyprwm/Hyprland/blob/main/src/config/ConfigManager.cpp
- https://github.com/hyprwm/Hyprland/blob/main/src/config/supplementary/jeremy/Jeremy.cpp
- https://github.com/hyprwm/Hyprland/blob/main/src/debug/HyprCtl.cpp

## File Loading

- Use `require` for stable hand-written modules.
- Hyprland sets Lua `package.path` to include the config directory as `?.lua` and `?/init.lua`.
- On reload, Hyprland clears non-stdlib `package.loaded` entries, so required user modules re-run.
- Hyprland wraps `require` and tracks required module paths for config watching.
- Use `dofile` for generated data files when cache avoidance matters.
- `dofile` paths are not source-backed as watched config paths, so generated writers should explicitly trigger reload when Lua config is live.

Sources:

- https://github.com/hyprwm/Hyprland/blob/main/example/hyprland.lua
- https://github.com/hyprwm/Hyprland/blob/main/src/config/lua/ConfigManager.cpp

## Rule Principles

- Preserve declaration order. Current `.conf` rule precedence depends on top-to-bottom order.
- Prefer anonymous rules for the first migration. They preserve declaration order and avoid same-name merge behavior.
- Named Lua rules can return handles and can be toggled, but same-name declarations reuse or merge with the existing rule object.
- `hl.window_rule(...)` and `hl.layer_rule(...)` return handles with `set_enabled(boolean)` and `is_enabled()`.

Sources:

- https://github.com/hyprwm/Hyprland/blob/main/src/config/lua/bindings/LuaBindingsConfigRules.cpp
- https://github.com/hyprwm/Hyprland/blob/main/src/config/lua/objects/LuaWindowRule.cpp
- https://github.com/hyprwm/Hyprland/blob/main/src/config/lua/objects/LuaLayerRule.cpp

## Window Rules

Basic shape:

```lua
hl.window_rule({
  match = {
    class = "^kitty$",
    title = ".*",
  },
  float = true,
  size = "900 900",
})
```

Relevant match keys for this repo:

| Hyprlang matcher | Lua match key |
| --- | --- |
| `match:class` | `class` |
| `match:title` | `title` |
| `match:initial_class` | `initial_class` |
| `match:initial_title` | `initial_title` |
| `match:workspace` | `workspace` |
| `match:float` | `float` |
| `match:fullscreen` | `fullscreen` |
| `match:pin` | `pin` |

Negative regex matchers keep the `negative:` prefix:

```lua
hl.window_rule({
  match = { workspace = "10", class = "negative:^(gamescope)$" },
  workspace = "special:gaming-overlay silent",
})
```

Relevant effect mappings for this repo:

| Hyprlang effect | Lua field | Lua value |
| --- | --- | --- |
| `float on` | `float` | `true` |
| `tile on` | `tile` | `true` |
| `fullscreen on` | `fullscreen` | `true` |
| `pin on` | `pin` | `true` |
| `no_anim on` | `no_anim` | `true` |
| `no_initial_focus on` | `no_initial_focus` | `true` |
| `no_shadow on` | `no_shadow` | `true` |
| `no_blur on` | `no_blur` | `true` |
| `center on` | `center` | `true` |
| `border_size 0` | `border_size` | `0` |
| `rounding 0` | `rounding` | `0` |
| `monitor HDMI-A-2` | `monitor` | `"HDMI-A-2"` |
| `size 900 900` | `size` | `"900 900"` |
| `move 2739 993` | `move` | `"2739 993"` |
| `move onscreen 100% 100%` | `move` | `"onscreen 100% 100%"` |
| `workspace 10 silent` | `workspace` | `"10 silent"` |
| `animation slide right` | `animation` | `"slide right"` |
| `opacity 1.0 override 1.0 override` | `opacity` | `"1.0 override 1.0 override"` |

Important: `size` and `move` are Lua config strings, not numeric arrays. Keep expression forms as strings, for example:

```lua
hl.window_rule({
  match = { class = "^(wiremix_terminal)$" },
  move = "(monitor_w-window_w-45) (monitor_h-window_h-50)",
})
```

Sources:

- https://github.com/hyprwm/Hyprland/blob/main/src/desktop/rule/Rule.cpp
- https://github.com/hyprwm/Hyprland/blob/main/src/desktop/rule/matchEngine/RegexMatchEngine.cpp
- https://github.com/hyprwm/Hyprland/blob/main/src/config/lua/bindings/LuaBindingsConfigRules.cpp
- https://github.com/hyprwm/Hyprland/blob/main/src/config/lua/bindings/LuaBindingsInternal.hpp
- https://wiki.hypr.land/Configuring/Window-Rules/

## Workspace Rules

Basic shape:

```lua
hl.workspace_rule({
  workspace = "2",
  monitor = "HDMI-A-2",
  layout = "master",
  layout_opts = { orientation = "bottom" },
})
```

Relevant field mappings for this repo:

| Hyprlang field | Lua field | Lua value |
| --- | --- | --- |
| workspace selector before comma | `workspace` | string |
| `monitor:DP-2` | `monitor` | `"DP-2"` |
| `default:true` | `default` | `true` |
| `layout:master` | `layout` | `"master"` |
| `layoutopt:orientation:left` | `layout_opts.orientation` | `"left"` |
| `layoutopt:mfact:0.7` | `layout_opts.mfact` | `0.7` |
| `gapsin:0` | `gaps_in` | `0` |
| `gapsout:0` | `gaps_out` | `0` |

Local examples:

```lua
hl.workspace_rule({
  workspace = "r[1-9] m[DP-2] w[tv2]",
  layout = "master",
  layout_opts = { orientation = "left", mfact = 0.7 },
})

hl.workspace_rule({
  workspace = "special:gaming-overlay",
  gaps_in = 0,
  gaps_out = 0,
})
```

Sources:

- https://github.com/hyprwm/Hyprland/blob/main/src/config/lua/bindings/LuaBindingsConfigRules.cpp
- https://wiki.hypr.land/Configuring/Basics/Workspace-Rules/

## Layer Rules

Basic shape:

```lua
local handle = hl.layer_rule({
  match = { namespace = "^my-overlay$" },
  no_anim = true,
})

handle:set_enabled(false)
```

Relevant fields:

- Match by `namespace`.
- Common effects: `no_anim`, `blur`, `blur_popups`, `ignore_alpha`, `dim_around`, `xray`, `animation`, `order`, `above_lock`, `no_screen_share`.
- Local static layer rules live in `lua/rules/layer.lua`. Load them in the same config phase as `appearance.conf` to avoid moving them ahead of window-state rules.

Sources:

- https://github.com/hyprwm/Hyprland/blob/main/example/hyprland.lua
- https://github.com/hyprwm/Hyprland/blob/main/src/config/lua/bindings/LuaBindingsConfigRules.cpp

## Generated Rules Guidance

- Keep generators writing data tables, not direct `hl.window_rule(...)` calls.
- Load generated data with `dofile` so reloads do not reuse stale Lua module cache.
- Generated writers should explicitly reload Hyprland after writes once Lua config is live.
- Keep generated data schema normalized, but convert to Lua API types in the loader.
- For `size` and `move`, loader output must be strings.

## Known Risks

- Lua config API is new and can change before this repo moves to a Hyprland release containing it.
- No mixed hyprlang source bridge is source-backed.
- `dofile` reload watching is not source-backed; generated writers need explicit reloads.
- Plugin namespaced effects are uncertain. If needed, exact keys likely require bracket syntax, for example `['hyprbars:no_bar'] = '1'`, but plugin registration must be confirmed first.
- Named rule behavior differs from simple anonymous declaration order when names are reused.

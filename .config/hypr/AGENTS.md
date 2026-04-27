# Hyprland Configuration - Agent Guide

Hyprland compositor configuration managed via Home Manager/Nix.

## Essentials

- Validate after every `.conf` change.
- Keep Lua migration files non-live unless explicitly testing Lua startup; do not create `.config/hypr/hyprland.lua` casually.
- Use directory modules with `init.lua` for grouped Lua config, e.g. `lua/rules/init.lua`, not sibling aggregators like `lua/rules.lua`.
- Keep static Lua rules as direct `hl.workspace_rule(...)` and `hl.window_rule(...)` calls under `lua/rules/workspace.lua` and `lua/rules/window.lua`.
- Keep generated/window-state Lua rule data under `lua/rules/generated.lua` and `lua/rules/window-state.lua`; generated files should return data tables, not call `hl.*` directly.
- Keep `window-state.conf` as the writable selector source during migration; mirror it to `lua/rules/window-state-selectors.lua` for Lua-side data.
- Preserve rule declaration order: generated rules, static rules, then window-state rules.

## Package manager

Home Manager/Nix

## Commands

- `hyprctl configerrors`
- `hyprctl reload` (optional)

## More Guidance

- [References](docs/agents/references/TOC.md)
- [Version info](docs/agents/version.md)
- [Lua configuration](docs/agents/lua-configuration.md)
- [Layer rules](docs/agents/layer-rules.md)
- [Configuration structure](docs/agents/structure.md)
- [Debugging tips](docs/agents/debugging.md)
- [Common pitfalls](docs/agents/pitfalls.md)

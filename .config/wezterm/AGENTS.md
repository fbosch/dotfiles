# WezTerm Configuration - Agent Guide

WezTerm Lua configuration.

## Essentials

- Keep `wezterm.lua` thin: build the config, apply modules, return the config.
- Keep modules scoped by concern and apply changes to the shared WezTerm config object.
- Use declarative `wezterm.action.*` tables for key bindings.
- Use `wezterm.on(...)` for runtime behavior; avoid custom polling loops.
- Never call reload/reconfigure APIs at file scope.
- Guard config overrides when they can emit reload/change events.
- Use `wezterm.GLOBAL` only for intentional state across config reload/evaluation contexts.

## Commands

- `lua .config/wezterm/tests/status_workhours_spec.lua`
- `lua .config/wezterm/tests/agent_deck_detection_spec.lua`

## More Guidance

- [Overview](README.md)

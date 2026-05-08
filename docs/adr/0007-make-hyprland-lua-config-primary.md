# Make Hyprland Lua Config Primary

**Status:** accepted
**Date:** 2026-04-28

## Context

The Hyprland Lua migration reached live parity: `hyprland.lua` validates, key runtime workflows work in daily use, generated quickrules and window-state data have Lua outputs, and `hypridle` dispatch calls were adjusted for Lua config. Keeping the Lua config under `.config/hypr/lua/` and the old hyprlang files at config root made the old setup look primary even though Lua is now the active path.

## Decision

Promote the Lua configuration to the primary `.config/hypr/` layout. Move Lua modules such as `actions/`, `lib/`, `rules/`, `runtime/`, and top-level Lua config modules up one directory so `hyprland.lua` can require root-scoped modules. Move the old hyprlang config graph and migration-only parity tooling under `.config/hypr/legacy/` for reference. Categorize runtime shell helpers by behavior area instead of keeping a flat `scripts/` directory.

## Alternatives Considered

Leaving Lua modules under `.config/hypr/lua/` was rejected because it preserved a staged-migration shape after Lua became primary. Deleting the hyprlang setup immediately was rejected because keeping it under `legacy/` provides useful reference during the final cleanup and regression window.

## Consequences

The active Hyprland setup is clearer: `hyprland.lua` and its modules live at config root, while old hyprlang files are explicitly legacy. Runtime helper paths are more discoverable by area, but external integrations must be updated from `.config/hypr/scripts/...` and `.config/hypr/lua/...` to the new categorized paths.

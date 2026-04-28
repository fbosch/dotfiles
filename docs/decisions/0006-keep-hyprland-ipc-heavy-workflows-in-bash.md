# Keep Hyprland IPC-Heavy Workflows In Bash

**Status:** accepted
**Date:** 2026-04-28

## Context

The Hyprland Lua migration aims to keep configuration logic mostly in one scripting language. During the migration, `SUPER+D` was ported from `toggle-show-desktop.sh` to an in-process Lua callback, but the compositor froze because the callback performed synchronous `hyprctl` work. An external Lua script launched through Hyprland `exec` avoided the compositor-thread callback issue, but the workflow still did not behave correctly and added complexity without reducing IPC dependence.

## Decision

Keep Hyprland workflows that depend heavily on `hyprctl` IPC in Bash for now. This includes show-desktop, minimize/restore, window-state persistence, window capture, and similar daemon-style or multi-dispatch workflows. Lua migration should focus first on small actions that can use Hyprland Lua APIs directly or do not require synchronous `hyprctl clients`, `hyprctl monitors`, or repeated dispatch calls.

## Alternatives Considered

Porting the full workflow into an in-process Lua callback was rejected because synchronous subprocess calls can block or deadlock the compositor. Launching an external Lua script through `hl.dsp.exec_cmd` was safer for compositor responsiveness, but it still depended on shelling out to `hyprctl` and did not provide enough benefit over the existing Bash implementation.

## Consequences

The migration boundary is clearer: Lua owns declarative config and lightweight actions, while IPC-heavy runtime automation remains in Bash. This avoids compositor freezes and reduces migration risk, but it means the Hyprland setup will intentionally remain multi-language until richer Lua APIs or event-driven helpers can replace the current `hyprctl`-based scripts.

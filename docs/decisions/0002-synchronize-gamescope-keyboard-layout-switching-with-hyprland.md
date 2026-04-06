# Synchronize Gamescope Keyboard Layout Switching with Hyprland

**Status:** accepted
**Date:** 2026-04-06

## Context

Keyboard layout switching in Hyprland works for native Wayland clients, but games running inside Gamescope keep using the previous layout. This creates inconsistent input behavior, especially when toggling between `us` and `dk` during gameplay. Restarting Gamescope or the game to apply a new layout is disruptive and not acceptable for normal use.

## Decision

Use the existing Hyprland layout-switch script as the single control point and extend it to synchronize layout changes into Gamescope Xwayland displays. On each shortcut-triggered layout toggle, the script reads the active layout after `hyprctl switchxkblayout` and applies the same layout to detected Gamescope Xwayland displays via `setxkbmap`. This preserves the current shortcut workflow while making in-game layout behavior match the desktop.

## Alternatives Considered

Relying on remapping tools such as `xremap` or `keyd` was rejected because the requirement is runtime layout switching, not remapping semantics. Disabling the Gamescope session or restarting games on every layout change was rejected due to poor usability. Per-launch static layout choices were also rejected because they do not support live switching during a session.

## Consequences

Layout switching now has one authoritative path and should behave consistently across Hyprland and Gamescope-managed games. The solution adds a dependency on `setxkbmap` availability for Gamescope sync, with a no-op fallback when unavailable. Future follow-up can improve robustness by tightening Gamescope display detection and adding telemetry around sync failures.

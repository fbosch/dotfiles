#!/usr/bin/env bash

set -euo pipefail

readonly MINIMIZED_WORKSPACE="special:minimized"

active_window_json="$(hyprctl activewindow -j 2>/dev/null || true)"
active_workspace="$(printf '%s' "$active_window_json" | jq -r '.workspace.name // empty' 2>/dev/null || true)"

if [[ "$active_workspace" == "$MINIMIZED_WORKSPACE" ]]; then
  hyprctl dispatch movetoworkspacesilent +0
  exit 0
fi

hyprctl dispatch movetoworkspacesilent "$MINIMIZED_WORKSPACE"

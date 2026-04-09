#!/usr/bin/env bash
# Wrapper script for window switching with fallback
# Usage: window-switcher-wrapper.sh [next|prev|commit|hide]

action="${1:-next}"

single_window_record=""
if [[ "$action" == "next" || "$action" == "prev" ]]; then
  single_window_record="$(hyprctl clients -j | jq -r '
    map(select(.workspace.id != -1)) |
    if length == 1 then
      .[0] |
      "\(.address)\t" +
      (
        if (.workspace.name // "") != "" then (.workspace.name // "")
        elif (.workspace.id != null) then (.workspace.id | tostring)
        else ""
        end
      )
    else
      empty
    end
  ')"
fi

if [[ -n "$single_window_record" ]]; then
  IFS=$'\t' read -r single_window_address single_window_workspace <<< "$single_window_record"

  if [[ -n "$single_window_workspace" ]]; then
    current_workspace_ref="$(hyprctl activeworkspace -j | jq -r '
      if (.name // "") != "" then (.name // "")
      elif (.id != null) then (.id | tostring)
      else ""
      end
    ')"

    if [[ "$single_window_workspace" != "$current_workspace_ref" ]]; then
      hyprctl dispatch workspace "$single_window_workspace"
    fi
  fi

  hyprctl dispatch focuswindow "address:${single_window_address}"
  exit 0
fi

# Check if window-switcher daemon is ready
if ags request -i ags-bundled window-switcher "" &>/dev/null; then
  # Daemon is ready, use it (handles state and delayed UI internally)
  ags request -i ags-bundled window-switcher "{\"action\":\"$action\"}"
else
  # Daemon is dead/not ready, fallback to cycle-windows.sh
  case "$action" in
    next)
      bash ~/.config/hypr/scripts/cycle-windows.sh next
      ;;
    prev)
      bash ~/.config/hypr/scripts/cycle-windows.sh prev
      ;;
    commit|hide)
      # These actions don't apply to the fallback script
      exit 0
      ;;
    *)
      bash ~/.config/hypr/scripts/cycle-windows.sh next
      ;;
  esac
fi

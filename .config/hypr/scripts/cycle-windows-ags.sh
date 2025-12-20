#!/usr/bin/env bash

set -euo pipefail

direction="${1:-next}"

# Grab the address of the currently focused window (may be null on empty workspace).
current_address="$(hyprctl activewindow -j | jq -r '.address // empty')"

# Sort windows with the same tuple Waybar uses when `sort-by-app-id=true`:
# app (class) first, then title, then address for stability. Track the workspace
# identifier alongside each entry so we can hop between workspaces as needed.
addresses=()
workspace_refs=()
titles=()
classes=()
while IFS=$'\t' read -r address workspace_ref title class; do
    addresses+=("$address")
    workspace_refs+=("$workspace_ref")
    titles+=("$title")
    classes+=("$class")
done < <(hyprctl clients -j | jq -r '
    map(select(.workspace.id != -1)) |
    sort_by([.class, (.title // ""), .address]) |
    .[] |
    "\(.address)\t" +
    (
        if (.workspace.name // "") != "" then (.workspace.name // "")
        elif (.workspace.id != null) then (.workspace.id | tostring)
        else ""
        end
    ) + "\t" + (.title // "") + "\t" + (.class // "")
')

window_count=${#addresses[@]}

(( window_count == 0 )) && exit 0
(( window_count == 1 )) && exit 0

current_index=-1
for i in "${!addresses[@]}"; do
    if [[ "${addresses[$i]}" == "${current_address}" ]]; then
        current_index=$i
        break
    fi
done

case "${direction}" in
    prev) step=-1 ;;
    next) step=1 ;;
    *)
        # Default to cycling backward if an unknown direction is passed.
        step=-1
        ;;
esac

if (( current_index == -1 )); then
    # Fallback: if the active window wasn't found in the list, start from either
    # the first or last entry depending on cycling direction.
    if (( step > 0 )); then
        next_index=0
    else
        next_index=$(( window_count - 1 ))
    fi
else
    next_index=$(( (current_index + step + window_count) % window_count ))
fi

target_workspace_ref="${workspace_refs[$next_index]}"

if [[ -n "${target_workspace_ref}" ]]; then
    current_workspace_ref="$(hyprctl activeworkspace -j | jq -r '
        if (.name // "") != "" then (.name // "")
        elif (.id != null) then (.id | tostring)
        else ""
        end
    ')"

    if [[ "${target_workspace_ref}" != "${current_workspace_ref}" ]]; then
        hyprctl dispatch workspace "${target_workspace_ref}"
    fi
fi

hyprctl dispatch focuswindow "address:${addresses[$next_index]}"

# Write window list and selection to /tmp/hypr-tab-cycle.json for AGS overlay
# Include class information for icon lookup
(
  printf '['
  for i in "${!addresses[@]}"; do
    printf '{"title": "%s", "address": "%s", "workspace": "%s", "class": "%s"}' \
      "${titles[$i]//"/\\"}" \
      "${addresses[$i]}" \
      "${workspace_refs[$i]}" \
      "${classes[$i]//"/\\"}"
    if (( i < window_count - 1 )); then printf ','; fi
  done
  printf ']'
) > /tmp/hypr-tab-cycle-windows.json

jq -n \
  --argjson windows "$(cat /tmp/hypr-tab-cycle-windows.json)" \
  --arg current_index "$next_index" \
  --arg direction "$direction" \
  '{windows: $windows, current_index: ($current_index|tonumber), direction: $direction}' \
  > /tmp/hypr-tab-cycle.json

rm -f /tmp/hypr-tab-cycle-windows.json

# Notify AGS window-switcher daemon to show/update
ags request -i window-switcher-daemon '{"action":"show"}' &>/dev/null || true

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
while IFS=$'\t' read -r address workspace_ref title; do
    addresses+=("$address")
    workspace_refs+=("$workspace_ref")
    titles+=("$title")
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
    ) + "\t" + (.title // "")
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

# Debug
echo "Current address: $current_address" > /tmp/alt-tab-debug.log
echo "Addresses: ${addresses[@]}" >> /tmp/alt-tab-debug.log
echo "Titles: ${titles[@]}" >> /tmp/alt-tab-debug.log
echo "Next index: $next_index" >> /tmp/alt-tab-debug.log
echo "Next address: ${addresses[$next_index]}" >> /tmp/alt-tab-debug.log

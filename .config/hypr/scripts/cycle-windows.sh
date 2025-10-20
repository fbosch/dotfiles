#!/usr/bin/env bash

direction="${1:-next}"

current_address=$(hyprctl activewindow -j | jq -r '.address')
all_windows=$(hyprctl clients -j | jq -r 'sort_by(.workspace.id) | .[] | select(.workspace.id != -1) | .address')

if [ -z "$all_windows" ]; then
    exit 0
fi

window_array=()
while IFS= read -r addr; do
    window_array+=("$addr")
done <<< "$all_windows"

current_index=-1
for i in "${!window_array[@]}"; do
    if [ "${window_array[$i]}" = "$current_address" ]; then
        current_index=$i
        break
    fi
done

if [ "$direction" = "prev" ]; then
    next_index=$(( (current_index - 1 + ${#window_array[@]}) % ${#window_array[@]} ))
else
    next_index=$(( (current_index + 1) % ${#window_array[@]} ))
fi

next_window="${window_array[$next_index]}"

if [ -n "$next_window" ]; then
    hyprctl dispatch focuswindow "address:$next_window"
fi

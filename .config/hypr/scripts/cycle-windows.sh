#!/usr/bin/env bash

direction="${1:-next}"

current_address=$(hyprctl activewindow -j | jq -r '.address')
# Sort by app_id (class) to match Waybar taskbar order
mapfile -t windows < <(hyprctl clients -j | jq -r 'sort_by(.class) | .[] | select(.workspace.id != -1) | .address')

[ ${#windows[@]} -eq 0 ] && exit 0

for i in "${!windows[@]}"; do
    [ "${windows[$i]}" = "$current_address" ] && current_index=$i && break
done

if [ "$direction" = "prev" ]; then
    next_index=$(( (current_index + 1) % ${#windows[@]} ))
else
    next_index=$(( (current_index - 1 + ${#windows[@]}) % ${#windows[@]} ))
fi

[ -n "${windows[$next_index]}" ] && hyprctl dispatch focuswindow "address:${windows[$next_index]}"

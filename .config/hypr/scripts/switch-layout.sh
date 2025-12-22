#!/bin/bash

# Configuration: Map layout codes to display codes for UI
# Add entries here for each keyboard layout you use
declare -A LAYOUT_DISPLAY_CODES=(
    ["us"]="ENG"
    ["dk"]="DAN"
)

# Get keyboard info from hyprctl
keyboard_info=$(hyprctl devices -j | jq -r '.keyboards[] | select(.main == true)')

# Extract configured layouts
IFS=',' read -ra layouts <<< "$(echo "$keyboard_info" | jq -r '.layout')"

# Get current active layout info
current_layout=$(echo "$keyboard_info" | jq -r '.active_keymap')
current_index=$(echo "$keyboard_info" | jq -r '.active_layout_index')

# Get the display code for current layout
current_code="${LAYOUT_DISPLAY_CODES[${layouts[$current_index]}]}"

# Switch to next layout
hyprctl switchxkblayout at-translated-set-2-keyboard next

# Wait a moment for the layout to change
sleep 0.1

# Get updated keyboard info after switch
keyboard_info=$(hyprctl devices -j | jq -r '.keyboards[] | select(.main == true)')
new_layout=$(echo "$keyboard_info" | jq -r '.active_keymap')
new_index=$(echo "$keyboard_info" | jq -r '.active_layout_index')

# Get the display code for the new active layout
active_code="${LAYOUT_DISPLAY_CODES[${layouts[$new_index]}]}"

# Show the AGS keyboard layout switcher overlay
# (Daemon is pre-started at boot by start-daemons.sh)

# Build layouts array with display codes for AGS
layout_codes_array=()
for layout in "${layouts[@]}"; do
    layout_codes_array+=("${LAYOUT_DISPLAY_CODES[$layout]}")
done

# Convert bash array to JSON array for AGS
layouts_json=$(printf '%s\n' "${layout_codes_array[@]}" | jq -R . | jq -s .)

# Send to AGS bundled daemon with the active layout indicated
ags request -i ags-bundled keyboard-switcher "{\"action\":\"show\",\"config\":{\"layouts\":$layouts_json,\"activeLayout\":\"$active_code\",\"size\":\"sm\"}}"

# Log to hyprland log for debugging
echo "Keyboard layout switched from $current_layout to $new_layout (code: $active_code)" >> /tmp/hyprland-layout.log

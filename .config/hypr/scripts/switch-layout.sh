#!/bin/bash

# Get current keyboard layout from the main keyboard
current_layout=$(hyprctl devices | grep -A 10 "at-translated-set-2-keyboard" | grep "active keymap:" | sed 's/.*active keymap: //')

# Define layouts array with display names and short codes for UI
layouts=("us" "dk")
layout_names=("English (US)" "Danish")
layout_codes=("EN" "DA")

# Find current layout index
current_index=0
for i in "${!layouts[@]}"; do
    if [[ "${layout_names[$i]}" == "$current_layout" ]]; then
        current_index=$i
        break
    fi
done

# Get the short code for the current layout
current_code="${layout_codes[$current_index]}"

# Calculate next layout index
next_index=$(( (current_index + 1) % ${#layouts[@]} ))
next_code="${layout_codes[$next_index]}"

# Switch to next layout
hyprctl switchxkblayout at-translated-set-2-keyboard next

# Wait a moment for the layout to change
sleep 0.1

# Get the new layout after switching
new_layout=$(hyprctl devices | grep -A 10 "at-translated-set-2-keyboard" | grep "active keymap:" | sed 's/.*active keymap: //')

# Find which layout is now active
active_code="EN"
for i in "${!layout_names[@]}"; do
    if [[ "${layout_names[$i]}" == "$new_layout" ]]; then
        active_code="${layout_codes[$i]}"
        break
    fi
done

# Show the AGS keyboard layout switcher overlay
# Start the daemon if it's not running
if ! ags list | grep -q "keyboard-layout-switcher-daemon"; then
    ags run ~/.config/ags/keyboard-layout-switcher.tsx &
    sleep 0.2
fi

# Always send layouts in the same order, just indicate which is active
# For 2 layouts: always show EN and DA, with activeLayout indicating which is current
ags request -i keyboard-layout-switcher-daemon '{"action":"show","config":{"layouts":["EN","DA"],"activeLayout":"'"$active_code"'","size":"sm"}}'

# Log to hyprland log for debugging
echo "Keyboard layout switched from $current_layout to $new_layout (code: $active_code)" >> /tmp/hyprland-layout.log

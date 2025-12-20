#!/usr/bin/env bash
# Shared library for waybar visibility checks

# Check if start menu is currently visible
check_start_menu_visible() {
    ags request -i start-menu-daemon '{"action":"is-visible"}' 2>/dev/null || echo "false"
}

# Check if SwayNC notification center is currently visible
check_swaync_visible() {
    busctl --user call org.erikreider.swaync.cc /org/erikreider/swaync/cc org.erikreider.swaync.cc GetVisibility 2>/dev/null | awk '{print $2}' || echo "false"
}

# Check if waybar should stay visible (returns 0 if should stay visible, 1 if can hide)
# Usage: should_waybar_stay_visible distance_from_bottom
should_waybar_stay_visible() {
    local distance_from_bottom=$1
    local threshold=${2:-60}  # Default threshold is 60px
    
    local start_menu_visible=$(check_start_menu_visible)
    local swaync_visible=$(check_swaync_visible)
    
    # Export for callers who want to log
    export START_MENU_VISIBLE="$start_menu_visible"
    export SWAYNC_VISIBLE="$swaync_visible"
    
    # Stay visible if:
    # - Cursor is near waybar (within threshold)
    # - Start menu is open
    # - SwayNC is open
    if [ "$distance_from_bottom" -le "$threshold" ] || \
       [ "$start_menu_visible" = "true" ] || \
       [ "$swaync_visible" = "true" ]; then
        return 0  # Should stay visible
    else
        return 1  # Can hide
    fi
}

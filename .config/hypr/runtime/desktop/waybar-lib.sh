#!/usr/bin/env bash
# Shared library for waybar visibility checks

# Check if start menu is currently visible
check_start_menu_visible() {
    ags request -i ags-bundled start-menu '{"action":"is-visible"}' 2>/dev/null || echo "false"
}

# Check if SwayNC notification center is currently visible
check_swaync_visible() {
    local result
    result=$(busctl --user call org.erikreider.swaync.cc /org/erikreider/swaync/cc org.erikreider.swaync.cc GetVisibility 2>/dev/null)
    # Result format is "b true" or "b false", extract second word
    echo "${result#* }"
}

# Check if waybar should stay visible (returns 0 if should stay visible, 1 if can hide)
# Usage: should_waybar_stay_visible distance_from_bottom [threshold]
should_waybar_stay_visible() {
    local distance_from_bottom=$1
    local threshold=${2:-60}  # Default threshold is 60px
    
    # Short-circuit: If cursor is near waybar, return immediately (no expensive checks needed)
    if [ "$distance_from_bottom" -le "$threshold" ]; then
        export START_MENU_VISIBLE="unknown"
        export SWAYNC_VISIBLE="unknown"
        return 0  # Should stay visible
    fi
    
    # Cursor is far - now check expensive menu states
    local start_menu_visible
    local swaync_visible
    start_menu_visible=$(check_start_menu_visible)
    swaync_visible=$(check_swaync_visible)
    
    # Export for callers who want to log
    export START_MENU_VISIBLE="$start_menu_visible"
    export SWAYNC_VISIBLE="$swaync_visible"
    
    # Stay visible if start menu or SwayNC is open
    if [ "$start_menu_visible" = "true" ] || [ "$swaync_visible" = "true" ]; then
        return 0  # Should stay visible
    else
        return 1  # Can hide
    fi
}

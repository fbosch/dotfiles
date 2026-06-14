#!/usr/bin/env bash
# Shared library for waybar visibility checks

# Check if start menu is currently visible
check_start_menu_visible() {
    ags request -i ags-bundled start-menu '{"action":"is-visible"}' 2>/dev/null || echo "false"
}

# Check if the calendar widget is currently visible
check_calendar_widget_visible() {
    ags request -i ags-bundled calendar-widget '{"action":"is-visible"}' 2>/dev/null || echo "false"
}

# Check if the audio mixer widget is currently visible
check_audio_mixer_widget_visible() {
    ags request -i ags-bundled audio-mixer-widget '{"action":"is-visible"}' 2>/dev/null || echo "false"
}

# Check if SwayNC notification center is currently visible
check_swaync_visible() {
    local result
    result=$(busctl --user call org.erikreider.swaync.cc /org/erikreider/swaync/cc org.erikreider.swaync.cc GetVisibility 2>/dev/null)
    # Result format is "b true" or "b false", extract second word
    echo "${result#* }"
}

# Check if a taskbar-adjacent app is currently shown from its parking workspace.
check_taskbar_app_open() {
    "$HOME/.config/hypr/taskbar/actions.sh" --any-open >/dev/null 2>&1
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
    local calendar_widget_visible
    local audio_mixer_widget_visible
    local swaync_visible
    local taskbar_app_open=false
    start_menu_visible=$(check_start_menu_visible)
    calendar_widget_visible=$(check_calendar_widget_visible)
    audio_mixer_widget_visible=$(check_audio_mixer_widget_visible)
    swaync_visible=$(check_swaync_visible)
    if check_taskbar_app_open; then
        taskbar_app_open=true
    fi
    
    # Export for callers who want to log
    export START_MENU_VISIBLE="$start_menu_visible"
    export CALENDAR_WIDGET_VISIBLE="$calendar_widget_visible"
    export AUDIO_MIXER_WIDGET_VISIBLE="$audio_mixer_widget_visible"
    export SWAYNC_VISIBLE="$swaync_visible"
    export TASKBAR_APP_OPEN="$taskbar_app_open"
    
    # Stay visible if a taskbar-adjacent surface is open
    if [ "$start_menu_visible" = "true" ] || [ "$calendar_widget_visible" = "true" ] || [ "$audio_mixer_widget_visible" = "true" ] || [ "$swaync_visible" = "true" ] || [ "$taskbar_app_open" = "true" ]; then
        return 0  # Should stay visible
    else
        return 1  # Can hide
    fi
}

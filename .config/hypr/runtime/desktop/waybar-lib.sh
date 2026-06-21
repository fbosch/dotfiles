#!/usr/bin/env bash
# Shared library for waybar visibility checks

# shellcheck disable=SC1091
. "${HOME}/.config/hypr/runtime/lib/ags-ipc.sh"

TASKBAR_AGS_COMPONENTS="start-menu calendar-widget audio-mixer-widget"

ags_component_visible() {
    local component=$1
    ags_request "$component" '{"action":"is-visible"}' 2>/dev/null || echo "false"
}

taskbar_ags_component_visible() {
    local component
    local visible

    component=$(ags_request taskbar-visibility '{"action":"visible-component"}' 2>/dev/null || echo "")
    if [ "$component" != "" ] && [ "$component" != "none" ] && [ "${component#error:}" = "$component" ]; then
        export TASKBAR_AGS_VISIBLE_COMPONENT="$component"
        return 0
    fi

    if [ "$component" = "none" ]; then
        export TASKBAR_AGS_VISIBLE_COMPONENT=""
        return 1
    fi

    for component in $TASKBAR_AGS_COMPONENTS; do
        visible=$(ags_component_visible "$component")
        if [ "$visible" = "true" ]; then
            export TASKBAR_AGS_VISIBLE_COMPONENT="$component"
            return 0
        fi
    done

    export TASKBAR_AGS_VISIBLE_COMPONENT=""
    return 1
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
        export TASKBAR_AGS_VISIBLE_COMPONENT="unknown"
        export SWAYNC_VISIBLE="unknown"
        return 0  # Should stay visible
    fi
    
    # Cursor is far - now check expensive menu states
    local swaync_visible
    local taskbar_ags_component_open=false
    local taskbar_app_open=false
    if taskbar_ags_component_visible; then
        taskbar_ags_component_open=true
    fi
    swaync_visible=$(check_swaync_visible)
    if check_taskbar_app_open; then
        taskbar_app_open=true
    fi
    
    # Export for callers who want to log
    export TASKBAR_AGS_COMPONENT_OPEN="$taskbar_ags_component_open"
    export SWAYNC_VISIBLE="$swaync_visible"
    export TASKBAR_APP_OPEN="$taskbar_app_open"
    
    # Stay visible if a taskbar-adjacent surface is open
    if [ "$taskbar_ags_component_open" = "true" ] || [ "$swaync_visible" = "true" ] || [ "$taskbar_app_open" = "true" ]; then
        return 0  # Should stay visible
    else
        return 1  # Can hide
    fi
}

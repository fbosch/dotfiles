#!/usr/bin/env bash
# Monitor mouse position and show/hide waybar based on screen edge proximity
# Optimized for low resource usage with integer arithmetic

# Configuration (all in milliseconds for integer math)
readonly SHOW_THRESHOLD=25      # Distance from bottom to trigger show (pixels)
readonly HIDE_THRESHOLD=60      # Distance from bottom before hiding (pixels)
readonly SHOW_DELAY_MS=200      # Milliseconds to wait before showing (prevents quick hovers)
readonly HIDE_DELAY_MS=300      # Milliseconds to wait before hiding (linger time)
readonly FAST_CHECK_MS=50       # Fast polling interval (50ms)
readonly SLOW_CHECK_MS=300      # Slow polling interval (300ms)

# Get monitor height once at startup (cached)
readonly MONITOR_HEIGHT=$(hyprctl monitors -j 2>/dev/null | jq -r '.[0].height')

# State variables
waybar_visible=0  # 0 = hidden, 1 = visible
show_timer_ms=0
hide_timer_ms=0

while true; do
    # Get cursor Y position (single read, minimal processing)
    IFS=',' read -r _ cursor_y <<< "$(hyprctl cursorpos 2>/dev/null)"
    cursor_y=${cursor_y## }  # Trim leading spaces (bash built-in)
    
    # Skip if cursor position unavailable
    [[ -z "$cursor_y" ]] && { sleep 0.3; continue; }
    
    # Calculate distance from bottom (integer arithmetic)
    distance_from_bottom=$((MONITOR_HEIGHT - cursor_y))
    
    # State machine logic
    if (( waybar_visible == 0 )); then
        # Waybar hidden - check if cursor is near bottom
        if (( distance_from_bottom <= SHOW_THRESHOLD )); then
            # Cursor is near bottom - increment show timer
            show_timer_ms=$((show_timer_ms + FAST_CHECK_MS))
            check_interval_ms=$FAST_CHECK_MS
            
            # Show after delay (prevents quick hovers)
            if (( show_timer_ms >= SHOW_DELAY_MS )); then
                pkill -SIGUSR1 waybar
                waybar_visible=1
                show_timer_ms=0
                hide_timer_ms=0
            fi
        else
            # Cursor moved away - reset show timer
            show_timer_ms=0
            # Adaptive polling when hidden
            check_interval_ms=$(( distance_from_bottom <= HIDE_THRESHOLD + 50 ? FAST_CHECK_MS : SLOW_CHECK_MS ))
        fi
    else
        # Waybar visible - check if cursor moved away
        check_interval_ms=$FAST_CHECK_MS
        
        if (( distance_from_bottom > HIDE_THRESHOLD )); then
            # Cursor is away - increment timer
            hide_timer_ms=$((hide_timer_ms + check_interval_ms))
            
            # Hide after delay
            if (( hide_timer_ms >= HIDE_DELAY_MS )); then
                pkill -SIGUSR2 waybar
                waybar_visible=0
                hide_timer_ms=0
            fi
        else
            # Cursor came back - reset timer
            hide_timer_ms=0
        fi
    fi
    
    # Sleep with calculated interval (convert ms to seconds)
    # 50ms = 0.05s, 300ms = 0.3s
    if (( check_interval_ms == FAST_CHECK_MS )); then
        sleep 0.05
    else
        sleep 0.3
    fi
done

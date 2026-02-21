#!/usr/bin/env bash
# Monitor mouse position and show/hide waybar based on screen edge proximity
# Optimized for low resource usage with integer arithmetic

# shellcheck disable=SC1091
# Source shared library
source "$(dirname "$0")/waybar-lib.sh"

# Configuration (all in milliseconds for integer math)
readonly SHOW_THRESHOLD=20     # Distance from bottom to trigger show (pixels)
readonly HIDE_THRESHOLD=60      # Distance from bottom before hiding (pixels)
readonly SHOW_DELAY_MS=200      # Milliseconds to wait before showing (prevents quick hovers)
readonly HIDE_DELAY_MS=300      # Milliseconds to wait before hiding (linger time)
readonly FAST_CHECK_MS=25       # Fast polling interval (25ms)
readonly SLOW_CHECK_MS=300      # Slow polling interval (300ms)

# Hyprland query socket (faster than hyprctl)
HYPR_QUERY_SOCKET="$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket.sock"

# Cache monitor info (updated periodically)
declare -A MONITOR_CACHE
monitor_cache_time=0
readonly CACHE_REFRESH_S=5  # Refresh monitor cache every 5 seconds

# Function to get current monitor info based on cursor position
get_current_monitor_height() {
    local cursor_x=$1
    local cursor_y=$2
    # Refresh cache if needed
    if (( EPOCHSECONDS - monitor_cache_time > CACHE_REFRESH_S )); then
        MONITOR_CACHE=()
        while IFS='|' read -r name x y width height transform; do
            # Account for monitor rotation (transforms 1 and 3 swap width/height)
            if [[ "$transform" == "1" || "$transform" == "3" ]]; then
                # 90° or 270° rotation - swap dimensions
                MONITOR_CACHE["$name"]="$x|$y|$height|$width"
            else
                MONITOR_CACHE["$name"]="$x|$y|$width|$height"
            fi
        done < <(printf 'j/monitors' | nc -U "$HYPR_QUERY_SOCKET" 2>/dev/null | jq -r '.[] | "\(.name)|\(.x)|\(.y)|\(.width)|\(.height)|\(.transform)"')
        monitor_cache_time=$EPOCHSECONDS
    fi
    
    # Find which monitor contains the cursor
    # First pass: exact match (cursor is actually within monitor bounds)
    for monitor_name in "${!MONITOR_CACHE[@]}"; do
        IFS='|' read -r mon_x mon_y mon_width mon_height <<< "${MONITOR_CACHE[$monitor_name]}"
        
        if (( cursor_x >= mon_x && cursor_x < mon_x + mon_width && 
              cursor_y >= mon_y && cursor_y < mon_y + mon_height )); then
            # Cursor is within this monitor
            local relative_y=$((cursor_y - mon_y))
            echo $((mon_height - relative_y))
            return 0
        fi
    done
    
    # Second pass: check with margin for edge cases (cursor pushed past edge)
    local margin=50
    local best_match=""
    local best_distance=999999
    
    for monitor_name in "${!MONITOR_CACHE[@]}"; do
        IFS='|' read -r mon_x mon_y mon_width mon_height <<< "${MONITOR_CACHE[$monitor_name]}"
        
        # Check if cursor is within this monitor's bounds (with small margin for edges)
        if (( cursor_x >= mon_x - margin && cursor_x < mon_x + mon_width + margin && 
              cursor_y >= mon_y - margin && cursor_y < mon_y + mon_height + margin )); then
            
            # Clamp cursor position to monitor bounds
            local clamped_y=$cursor_y
            (( clamped_y < mon_y )) && clamped_y=$mon_y
            (( clamped_y >= mon_y + mon_height )) && clamped_y=$((mon_y + mon_height - 1))
            
            local relative_y=$((clamped_y - mon_y))
            local dist_from_bottom=$((mon_height - relative_y))
            
            # Choose the closest monitor to cursor
            if (( dist_from_bottom < best_distance )); then
                best_distance=$dist_from_bottom
                best_match=$monitor_name
            fi
        fi
    done
    
    # Return the best match from second pass
    if [[ -n "$best_match" ]]; then
        echo $best_distance
        return 0
    fi
    
    # Fallback: return -1 if no monitor found
    echo -1
}

# State variables
waybar_visible=0  # 0 = hidden, 1 = visible
show_timer_ms=0
hide_timer_ms=0

# Enable debugging
echo "$(date): Script started" > /tmp/edge-debug.log

while true; do
    # Get cursor position (single read, minimal processing)
    IFS=',' read -r cursor_x cursor_y <<< "$(printf 'cursorpos' | nc -U "$HYPR_QUERY_SOCKET" 2>/dev/null)"
    cursor_x=${cursor_x## }  # Trim leading spaces (bash built-in)
    cursor_y=${cursor_y## }  # Trim leading spaces (bash built-in)
    
    # Skip if cursor position unavailable
    [[ -z "$cursor_x" || -z "$cursor_y" ]] && { sleep 0.3; continue; }
    
    # Calculate distance from bottom of current monitor (integer arithmetic)
    distance_from_bottom=$(get_current_monitor_height "$cursor_x" "$cursor_y")
    
    # Skip if we couldn't determine the monitor
    [[ $distance_from_bottom -lt 0 ]] && { sleep 0.3; continue; }

    # State machine logic
    if (( waybar_visible == 0 )); then
        # Waybar hidden - check if cursor is near bottom
        if (( distance_from_bottom <= SHOW_THRESHOLD )); then
            # Cursor is near bottom - increment show timer
            show_timer_ms=$((show_timer_ms + FAST_CHECK_MS))
            check_interval_ms=$FAST_CHECK_MS
            
            echo "$(date +%T): Near edge dist=$distance_from_bottom timer=$show_timer_ms" >> /tmp/edge-debug.log
            
            # Show after delay (prevents quick hovers)
            if (( show_timer_ms >= SHOW_DELAY_MS )); then
                echo "$(date +%T): SHOWING waybar" >> /tmp/edge-debug.log
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

            # Check if waybar should stay visible (using shared logic)
            if (( hide_timer_ms >= HIDE_DELAY_MS )); then
                if ! should_waybar_stay_visible "$distance_from_bottom" "$HIDE_THRESHOLD"; then
                    echo "$(date): distance=$distance_from_bottom, menu_visible=$START_MENU_VISIBLE, swaync_visible=$SWAYNC_VISIBLE - HIDING" >> /tmp/edge-debug.log
                    pkill -SIGUSR2 waybar
                    waybar_visible=0
                    hide_timer_ms=0
                else
                    echo "$(date): distance=$distance_from_bottom, menu_visible=$START_MENU_VISIBLE, swaync_visible=$SWAYNC_VISIBLE - KEEPING VISIBLE" >> /tmp/edge-debug.log
                    # Reset timer since we want to keep checking
                    hide_timer_ms=0
                fi
            fi
        else
            # Cursor came back - reset timer
            hide_timer_ms=0
        fi
    fi
    
    # Sleep with calculated interval (convert ms to seconds)
    # 25ms = 0.025s, 300ms = 0.3s
    if (( check_interval_ms == FAST_CHECK_MS )); then
        sleep 0.025
    else
        sleep 0.3
    fi
done

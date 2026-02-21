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

# Sets global DISTANCE_FROM_BOTTOM to pixels from bottom of current monitor.
# Returns 1 (and sets DISTANCE_FROM_BOTTOM=-1) if monitor cannot be determined.
update_distance_from_bottom() {
    local cursor_x=$1 cursor_y=$2

    # Refresh monitor cache if stale
    if (( EPOCHSECONDS - monitor_cache_time > CACHE_REFRESH_S )); then
        MONITOR_CACHE=()
        while IFS='|' read -r name x y width height transform; do
            if [[ "$transform" == "1" || "$transform" == "3" ]]; then
                MONITOR_CACHE["$name"]="$x|$y|$height|$width"
            else
                MONITOR_CACHE["$name"]="$x|$y|$width|$height"
            fi
        done < <(printf 'j/monitors' | nc -U "$HYPR_QUERY_SOCKET" 2>/dev/null | jq -r '.[] | "\(.name)|\(.x)|\(.y)|\(.width)|\(.height)|\(.transform)"')
        monitor_cache_time=$EPOCHSECONDS
    fi

    # Single pass: exact match first, fallback to nearest within margin
    local margin=50
    local best_distance=999999 best_set=0
    local mon_x mon_y mon_width mon_height

    for monitor_name in "${!MONITOR_CACHE[@]}"; do
        IFS='|' read -r mon_x mon_y mon_width mon_height <<< "${MONITOR_CACHE[$monitor_name]}"

        if (( cursor_x >= mon_x && cursor_x < mon_x + mon_width &&
              cursor_y >= mon_y && cursor_y < mon_y + mon_height )); then
            # Exact match — use immediately
            DISTANCE_FROM_BOTTOM=$(( mon_height - (cursor_y - mon_y) ))
            return 0
        fi

        # Fallback: within margin
        if (( cursor_x >= mon_x - margin && cursor_x < mon_x + mon_width + margin &&
              cursor_y >= mon_y - margin && cursor_y < mon_y + mon_height + margin )); then
            local clamped_y=$cursor_y
            (( clamped_y < mon_y )) && clamped_y=$mon_y
            (( clamped_y >= mon_y + mon_height )) && clamped_y=$(( mon_y + mon_height - 1 ))
            local dist=$(( mon_height - (clamped_y - mon_y) ))
            if (( dist < best_distance )); then
                best_distance=$dist
                best_set=1
            fi
        fi
    done

    if (( best_set )); then
        DISTANCE_FROM_BOTTOM=$best_distance
        return 0
    fi

    DISTANCE_FROM_BOTTOM=-1
    return 1
}

# State variables
waybar_visible=0  # 0 = hidden, 1 = visible
show_timer_ms=0
hide_timer_ms=0

while true; do
    # Get cursor position (single read, minimal processing)
    IFS=',' read -r cursor_x cursor_y <<< "$(printf 'cursorpos' | nc -U "$HYPR_QUERY_SOCKET" 2>/dev/null)"
    cursor_x=${cursor_x## }  # Trim leading spaces (bash built-in)
    cursor_y=${cursor_y## }  # Trim leading spaces (bash built-in)
    
    # Skip if cursor position unavailable
    [[ -z "$cursor_x" || -z "$cursor_y" ]] && { sleep 0.3; continue; }
    
    # Calculate distance from bottom of current monitor (integer arithmetic)
    update_distance_from_bottom "$cursor_x" "$cursor_y" || { sleep 0.3; continue; }

    # State machine logic
    if (( waybar_visible == 0 )); then
        # Waybar hidden - check if cursor is near bottom
        if (( DISTANCE_FROM_BOTTOM <= SHOW_THRESHOLD )); then
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
            check_interval_ms=$(( DISTANCE_FROM_BOTTOM <= HIDE_THRESHOLD + 50 ? FAST_CHECK_MS : SLOW_CHECK_MS ))
        fi
    else
        # Waybar visible - fast poll near edge or when hide is imminent, slow otherwise
        check_interval_ms=$(( DISTANCE_FROM_BOTTOM <= HIDE_THRESHOLD || hide_timer_ms > 0 ? FAST_CHECK_MS : SLOW_CHECK_MS ))

        if (( DISTANCE_FROM_BOTTOM > HIDE_THRESHOLD )); then
            # Cursor is away - increment timer
            hide_timer_ms=$((hide_timer_ms + check_interval_ms))

            # Check if waybar should stay visible (using shared logic)
            if (( hide_timer_ms >= HIDE_DELAY_MS )); then
                if ! should_waybar_stay_visible "$DISTANCE_FROM_BOTTOM" "$HIDE_THRESHOLD"; then
                    pkill -SIGUSR2 waybar
                    waybar_visible=0
                fi
                hide_timer_ms=0
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

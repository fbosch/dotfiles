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
readonly FAST_CHECK_MS=40       # Fast polling interval (40ms)
readonly SLOW_CHECK_MS=500      # Slow polling interval (500ms)

# Hyprland query socket (faster than hyprctl)
HYPR_QUERY_SOCKET=""

refresh_hypr_query_socket() {
    HYPR_QUERY_SOCKET="$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket.sock"
}

# Query Hyprland IPC socket with a short timeout.
# Prints response to stdout and returns non-zero on failure.
hypr_query() {
    local request=$1

    refresh_hypr_query_socket

    if command -v timeout >/dev/null 2>&1; then
        printf '%s' "$request" | timeout 0.2 nc -U "$HYPR_QUERY_SOCKET" 2>/dev/null
        return $?
    fi

    printf '%s' "$request" | nc -U "$HYPR_QUERY_SOCKET" 2>/dev/null
}

now_ms() {
    printf '%.0f\n' "${EPOCHREALTIME//[.,]/}e-3"
}

# Cache monitor info (updated periodically)
declare -A MONITOR_CACHE
monitor_cache_time=0
readonly CACHE_REFRESH_S=10  # Refresh monitor cache every 10 seconds
last_monitor_name=""

# Sets global DISTANCE_FROM_BOTTOM to pixels from bottom of current monitor.
# Returns 1 (and sets DISTANCE_FROM_BOTTOM=-1) if monitor cannot be determined.
update_distance_from_bottom() {
    local cursor_x=$1 cursor_y=$2

    # Refresh monitor cache if stale
    if (( EPOCHSECONDS - monitor_cache_time > CACHE_REFRESH_S )); then
        local -A new_cache
        local monitor_data=""

        monitor_data=$(hypr_query 'j/monitors')
        if [[ -n "$monitor_data" ]]; then
        while IFS='|' read -r name x y width height transform; do
            if [[ "$transform" == "1" || "$transform" == "3" ]]; then
                new_cache["$name"]="$x|$y|$height|$width"
            else
                new_cache["$name"]="$x|$y|$width|$height"
            fi
        done < <(jq -r '.[] | "\(.name)|\(.x)|\(.y)|\(.width)|\(.height)|\(.transform)"' <<< "$monitor_data" 2>/dev/null)
        fi

        if (( ${#new_cache[@]} > 0 )); then
            MONITOR_CACHE=()
            for monitor_name in "${!new_cache[@]}"; do
                MONITOR_CACHE["$monitor_name"]="${new_cache[$monitor_name]}"
            done
            monitor_cache_time=$EPOCHSECONDS
        elif (( ${#MONITOR_CACHE[@]} == 0 )); then
            DISTANCE_FROM_BOTTOM=-1
            return 1
        fi
    fi

    if [[ -n "$last_monitor_name" && -n "${MONITOR_CACHE[$last_monitor_name]:-}" ]]; then
        local last_x last_y last_width last_height
        IFS='|' read -r last_x last_y last_width last_height <<< "${MONITOR_CACHE[$last_monitor_name]}"

        if (( cursor_x >= last_x && cursor_x < last_x + last_width &&
              cursor_y >= last_y && cursor_y < last_y + last_height )); then
            DISTANCE_FROM_BOTTOM=$(( last_height - (cursor_y - last_y) ))
            return 0
        fi
    fi

    # Single pass: exact match first, fallback to nearest within margin
    local margin=50
    local best_distance=999999 best_set=0
    local best_monitor_name=""
    local mon_x mon_y mon_width mon_height

    for monitor_name in "${!MONITOR_CACHE[@]}"; do
        IFS='|' read -r mon_x mon_y mon_width mon_height <<< "${MONITOR_CACHE[$monitor_name]}"

        if (( cursor_x >= mon_x && cursor_x < mon_x + mon_width &&
              cursor_y >= mon_y && cursor_y < mon_y + mon_height )); then
            # Exact match — use immediately
            last_monitor_name="$monitor_name"
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
                best_monitor_name="$monitor_name"
            fi
        fi
    done

    if (( best_set )); then
        last_monitor_name="$best_monitor_name"
        DISTANCE_FROM_BOTTOM=$best_distance
        return 0
    fi

    DISTANCE_FROM_BOTTOM=-1
    return 1
}

# State variables
waybar_visible=0  # 0 = hidden, 1 = visible
show_started_ms=0
hide_started_ms=0

if pgrep -x waybar >/dev/null 2>&1; then
    waybar_visible=1
fi

while true; do
    # Get cursor position (single read, minimal processing)
    IFS=',' read -r cursor_x cursor_y <<< "$(hypr_query 'cursorpos')"
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
            now=$(now_ms)
            if (( show_started_ms == 0 )); then
                show_started_ms=$now
            fi

            check_interval_ms=$FAST_CHECK_MS

            # Show after delay (prevents quick hovers)
            if (( now - show_started_ms >= SHOW_DELAY_MS )); then
                if pkill -SIGUSR1 waybar; then
                    waybar_visible=1
                fi
                show_started_ms=0
                hide_started_ms=0
            fi
        else
            # Cursor moved away - reset show timer
            show_started_ms=0
            # Adaptive polling when hidden
            check_interval_ms=$(( DISTANCE_FROM_BOTTOM <= HIDE_THRESHOLD + 50 ? FAST_CHECK_MS : SLOW_CHECK_MS ))
        fi
    else
        # Waybar visible - fast poll near edge or when hide is imminent, slow otherwise
        check_interval_ms=$(( DISTANCE_FROM_BOTTOM <= HIDE_THRESHOLD || hide_started_ms > 0 ? FAST_CHECK_MS : SLOW_CHECK_MS ))

        if (( DISTANCE_FROM_BOTTOM > HIDE_THRESHOLD )); then
            now=$(now_ms)
            if (( hide_started_ms == 0 )); then
                hide_started_ms=$now
            fi

            # Check if waybar should stay visible (using shared logic)
            if (( now - hide_started_ms >= HIDE_DELAY_MS )); then
                if should_waybar_stay_visible "$DISTANCE_FROM_BOTTOM" "$HIDE_THRESHOLD"; then
                    :
                else
                    if pkill -SIGUSR2 waybar; then
                        waybar_visible=0
                    fi
                fi
                hide_started_ms=0
            fi
        else
            # Cursor came back - reset timer
            hide_started_ms=0
        fi
    fi
    
    # Sleep with calculated interval (convert ms to seconds)
    # 40ms = 0.04s, 500ms = 0.5s
    if (( check_interval_ms == FAST_CHECK_MS )); then
        sleep 0.04
    else
        sleep 0.5
    fi
done

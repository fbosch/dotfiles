#!/usr/bin/env bash
# Window State Persistence for Hyprland
# Uses hybrid approach: socket2 events + conditional polling (only when needed)

# Re-exec with SCHED_IDLE scheduling if not already running with it
if [[ -z "${WINDOW_STATE_IDLE_SCHED}" ]]; then
    if command -v chrt &>/dev/null; then
        export WINDOW_STATE_IDLE_SCHED=1
        exec chrt -i 0 "$0" "$@"
    fi
fi

CONFIG_FILE="$HOME/.config/hypr/window-state.conf"
RULES_FILE="$HOME/.config/hypr/window-state-rules.conf"
STATE_FILE="/tmp/hypr-window-state.cache"
DEBOUNCE_DELAY=1  # Wait 1 second after last change before saving
POLL_PID=""  # Track polling subprocess
CPU_COUNT=$(nproc)  # Number of CPU cores for load calculation

# Load window class patterns from config
load_patterns() {
    [[ ! -f "$CONFIG_FILE" ]] && return 1
    grep -v '^#' "$CONFIG_FILE" | grep -v '^[[:space:]]*$'
}

# Build regex pattern for matching
build_pattern() {
    load_patterns | paste -sd '|'
}

# Initialize rules file if needed
init_rules_file() {
    if [[ ! -f "$RULES_FILE" ]] || [[ ! -s "$RULES_FILE" ]] || ! grep -q "^# Auto-generated window state persistence rules" "$RULES_FILE"; then
        {
            echo "# Auto-generated window state persistence rules"
            echo "# Last updated: $(date '+%Y-%m-%d %H:%M:%S')"
            echo "# Config: $CONFIG_FILE"
            echo "# DO NOT EDIT MANUALLY - This file is managed by window-state.sh"
            echo ""
        } > "$RULES_FILE"
    fi
}

# Get current window states as JSON
get_window_states() {
    local pattern
    pattern=$(build_pattern)
    
    [[ -z "$pattern" ]] && echo "[]" && return
    
    hyprctl clients -j | jq -c --arg pattern "$pattern" '
        [.[] | select(.floating and (.class | test($pattern))) |
        {class: .class, x: .at[0], y: .at[1], width: .size[0], height: .size[1]}] | sort_by(.class)
    '
}

# Check if any tracked floating windows exist
has_tracked_windows() {
    local state
    state=$(get_window_states)
    [[ "$state" != "[]" && -n "$state" ]]
}

# Adaptive sleep based on system load
adaptive_sleep() {
    local load
    load=$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo "0")
    
    # Compare load to CPU count (if load > cores, system is busy)
    if command -v bc &>/dev/null; then
        if (( $(echo "$load > $CPU_COUNT" | bc -l 2>/dev/null || echo 0) )); then
            sleep 1.0  # System busy - poll slower
        else
            sleep 0.4  # System idle - poll faster for responsiveness
        fi
    else
        sleep 0.5  # Fallback if bc not available
    fi
}

# Start polling subprocess
start_polling() {
    # Don't start if already polling
    [[ -n "$POLL_PID" ]] && kill -0 "$POLL_PID" 2>/dev/null && return
    
    {
        while true; do
            # Check if we should stop (no tracked windows)
            if ! has_tracked_windows; then
                echo "$(date '+%H:%M:%S') - No tracked windows, stopping poll"
                exit 0
            fi
            
            check_and_save
            adaptive_sleep
        done
    } &
    
    POLL_PID=$!
    echo "$(date '+%H:%M:%S') - Started polling (PID: $POLL_PID)"
}

# Stop polling subprocess
stop_polling() {
    if [[ -n "$POLL_PID" ]]; then
        if kill -0 "$POLL_PID" 2>/dev/null; then
            kill "$POLL_PID" 2>/dev/null
            echo "$(date '+%H:%M:%S') - Stopped polling (PID: $POLL_PID)"
        fi
        POLL_PID=""
    fi
}

# Check if window states changed
states_changed() {
    local new_state="$1"
    local old_state
    
    [[ ! -f "$STATE_FILE" ]] && return 0
    
    old_state=$(cat "$STATE_FILE")
    [[ "$new_state" != "$old_state" ]]
}

# Save window states to rules file
save_rules() {
    local windows="$1"
    
    [[ -z "$windows" || "$windows" == "[]" ]] && return
    
    # Create new rules file content
    local temp_file=$(mktemp)
    cat > "$temp_file" << EOF
# Auto-generated window state persistence rules
# Last updated: $(date '+%Y-%m-%d %H:%M:%S')
# Config: $CONFIG_FILE
# DO NOT EDIT MANUALLY - This file is managed by window-state.sh

EOF
    
    # Process each window
    echo "$windows" | jq -c '.[]' | while IFS= read -r window; do
        local class x y width height
        class=$(echo "$window" | jq -r '.class')
        x=$(echo "$window" | jq -r '.x')
        y=$(echo "$window" | jq -r '.y')
        width=$(echo "$window" | jq -r '.width')
        height=$(echo "$window" | jq -r '.height')
        
        {
            echo "# $class"
            echo "windowrule = size $width $height, match:class ^($class)\$"
            echo "windowrule = move $x $y, match:class ^($class)\$"
            echo ""
        } >> "$temp_file"
        
        echo "$(date '+%H:%M:%S') - Saved $class: ${width}x${height} at ($x,$y)"
    done
    
    # Atomically replace rules file
    mv "$temp_file" "$RULES_FILE"
    
    # Save state cache
    echo "$windows" > "$STATE_FILE"
    
    # Reload config
    hyprctl reload config-only &>/dev/null
    echo "$(date '+%H:%M:%S') - Config reloaded"
}

# Debounced check and save
check_and_save() {
    local current_state
    current_state=$(get_window_states)
    
    [[ -z "$current_state" || "$current_state" == "[]" ]] && return
    
    if states_changed "$current_state"; then
        # State changed - save to cache and reset debounce timer
        echo "$current_state" > "$STATE_FILE"
        echo "$EPOCHSECONDS" > /tmp/hypr-window-state-debounce
        echo "$(date '+%H:%M:%S') - State changed, starting ${DEBOUNCE_DELAY}s debounce"
        return
    fi
    
    # No change - check if debounce period has elapsed
    if [[ -f /tmp/hypr-window-state-debounce ]]; then
        local last_change=$(cat /tmp/hypr-window-state-debounce)
        local elapsed=$((EPOCHSECONDS - last_change))
        
        if ((elapsed >= DEBOUNCE_DELAY)); then
            echo "$(date '+%H:%M:%S') - Debounce period elapsed, saving rules"
            save_rules "$current_state"
            rm -f /tmp/hypr-window-state-debounce
        fi
    fi
}

# Immediate save (bypass debounce) - used for critical events like window close
immediate_save() {
    local current_state
    current_state=$(get_window_states)
    
    # If no windows remain, we still want to save the state before they all closed
    # So we use the cached state if current is empty
    if [[ -z "$current_state" || "$current_state" == "[]" ]]; then
        if [[ -f "$STATE_FILE" ]]; then
            current_state=$(cat "$STATE_FILE")
        fi
    fi
    
    [[ -z "$current_state" || "$current_state" == "[]" ]] && return
    
    if states_changed "$current_state"; then
        echo "$(date '+%H:%M:%S') - Immediate save triggered"
        save_rules "$current_state"
        rm -f /tmp/hypr-window-state-debounce
    fi
}

# Event handler for socket2
handle_event() {
    local event="$1"
    
    case "$event" in
        openwindow*|changefloatingmode*)
            # Window opened or changed float mode - might need to start tracking
            if has_tracked_windows; then
                start_polling
                check_and_save
            fi
            ;;
        closewindow*)
            # Window closed - save immediately to capture last position
            immediate_save
            
            # Then check if we should stop polling
            if has_tracked_windows; then
                check_and_save
            else
                stop_polling
            fi
            ;;
        movewindowv2*)
            # Window moved to different workspace - might need to update or stop tracking
            if has_tracked_windows; then
                check_and_save
            else
                stop_polling
            fi
            ;;
        configreloaded*)
            # Config reloaded - recheck what we're tracking
            if has_tracked_windows; then
                start_polling
                check_and_save
            else
                stop_polling
            fi
            ;;
    esac
}

# Main
echo "Window state persistence started (event-driven + adaptive polling)"
echo "Config: $CONFIG_FILE"
echo "Rules: $RULES_FILE"
echo "Debounce delay: ${DEBOUNCE_DELAY}s"
echo "Scheduling: SCHED_IDLE (runs only when CPU is idle)"
echo "Poll rate: Adaptive based on system load (0.4s-1.0s)"
echo ""

init_rules_file

# Check if we need to start polling immediately
if has_tracked_windows; then
    echo "$(date '+%H:%M:%S') - Tracked windows detected, starting poll"
    start_polling
    check_and_save
else
    echo "$(date '+%H:%M:%S') - No tracked windows, idle (waiting for events)"
fi

# Cleanup handler
cleanup() {
    echo "$(date '+%H:%M:%S') - Shutting down..."
    stop_polling
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# Listen to Hyprland events
socat -U - "UNIX-CONNECT:$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock" | \
while IFS= read -r line; do
    handle_event "$line"
done

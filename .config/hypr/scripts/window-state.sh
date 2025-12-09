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
STATE_HASH_FILE="/tmp/hypr-window-state.hash"
DEBOUNCE_DELAY=1  # Wait 1 second after last change before saving
POLL_PID=""  # Track polling subprocess
CPU_COUNT=$(nproc)  # Number of CPU cores for load calculation
CURRENT_HASH=""  # Memory cache for state hash

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

# Check if any tracked floating windows exist (checks if state is non-empty)
is_state_empty() {
    local state="$1"
    [[ -z "$state" || "$state" == "[]" ]]
}

# Adaptive sleep based on system load
adaptive_sleep() {
    local load
    load=$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo "0")
    
    # Compare load to CPU count (if load > cores, system is busy)
    if command -v bc &>/dev/null; then
        if (( $(echo "$load > $CPU_COUNT" | bc -l 2>/dev/null || echo 0) )); then
            sleep 0.5  # System busy - poll slower but still responsive
        else
            sleep 0.25  # System idle - poll very fast to catch quick window closes
        fi
    else
        sleep 0.3  # Fallback if bc not available
    fi
}

# Start polling subprocess
start_polling() {
    # Don't start if already polling
    [[ -n "$POLL_PID" ]] && kill -0 "$POLL_PID" 2>/dev/null && return
    
    {
        while true; do
            # Get window states once per iteration
            local current_state
            current_state=$(get_window_states)
            
            # Check if we should stop (no tracked windows)
            if is_state_empty "$current_state"; then
                printf '%s - No tracked windows, stopping poll\n' "$(date '+%H:%M:%S')"
                exit 0
            fi
            
            # Pass state to avoid re-fetching
            check_and_save_with_state "$current_state"
            adaptive_sleep
        done
    } &
    
    POLL_PID=$!
    printf '%s - Started polling (PID: %s)\n' "$(date '+%H:%M:%S')" "$POLL_PID"
}

# Stop polling subprocess
stop_polling() {
    if [[ -n "$POLL_PID" ]]; then
        if kill -0 "$POLL_PID" 2>/dev/null; then
            kill "$POLL_PID" 2>/dev/null
            printf '%s - Stopped polling (PID: %s)\n' "$(date '+%H:%M:%S')" "$POLL_PID"
        fi
        POLL_PID=""
    fi
}

# Check if window states changed (using hash comparison for speed)
states_changed() {
    local new_state="$1"
    local new_hash
    
    # Generate hash of new state
    new_hash=$(md5sum <<< "$new_state" | cut -d' ' -f1)
    
    # Compare with cached hash (in memory)
    if [[ "$new_hash" != "$CURRENT_HASH" ]]; then
        CURRENT_HASH="$new_hash"
        return 0
    fi
    
    return 1
}

# Update or add rules for specific window classes (preserves existing rules)
update_rules() {
    local windows="$1"
    
    [[ -z "$windows" || "$windows" == "[]" ]] && return
    
    # Read existing rules into associative array
    declare -A existing_rules
    if [[ -f "$RULES_FILE" ]] && [[ -s "$RULES_FILE" ]]; then
        local current_class=""
        while IFS= read -r line; do
            # Match class comments like "# org.gnome.TextEditor"
            if [[ "$line" =~ ^#\ ([a-zA-Z0-9._-]+)$ ]]; then
                current_class="${BASH_REMATCH[1]}"
            elif [[ -n "$current_class" ]] && [[ -n "$line" ]]; then
                # Store rules for this class (skip empty lines)
                if [[ -z "${existing_rules[$current_class]}" ]]; then
                    existing_rules[$current_class]="$line"
                else
                    existing_rules[$current_class]+=$'\n'"$line"
                fi
            fi
        done < "$RULES_FILE"
    fi
    
    # Update rules for currently open windows
    while IFS='|' read -r class x y width height; do
        [[ -z "$class" ]] && continue
        
        # Update rules for this class
        existing_rules[$class]=$(printf 'windowrule = size %s %s, match:class ^(%s)$\nwindowrule = move %s %s, match:class ^(%s)$' \
            "$width" "$height" "$class" "$x" "$y" "$class")
        
        printf '%s - Updated %s: %sx%s at (%s,%s)\n' "$(date '+%H:%M:%S')" "$class" "$width" "$height" "$x" "$y"
    done < <(jq -r '.[] | "\(.class)|\(.x)|\(.y)|\(.width)|\(.height)"' <<< "$windows")
    
    # Write all rules (existing + updated) to new file
    local temp_file=$(mktemp)
    {
        printf '# Auto-generated window state persistence rules\n'
        printf '# Last updated: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
        printf '# Config: %s\n' "$CONFIG_FILE"
        printf '# DO NOT EDIT MANUALLY - This file is managed by window-state.sh\n'
        printf '\n'
    } > "$temp_file"
    
    # Write rules for all classes (sorted)
    for class in $(printf '%s\n' "${!existing_rules[@]}" | sort); do
        {
            printf '# %s\n' "$class"
            printf '%s\n' "${existing_rules[$class]}"
            printf '\n'
        } >> "$temp_file"
    done
    
    # Atomically replace rules file
    mv "$temp_file" "$RULES_FILE"
    
    # Save state cache
    printf '%s\n' "$windows" > "$STATE_FILE"
    
    # Reload config
    hyprctl reload config-only &>/dev/null
    printf '%s - Config reloaded\n' "$(date '+%H:%M:%S')"
}

# Legacy wrapper - redirect to update_rules
save_rules() {
    update_rules "$@"
}

# Debounced check and save (accepts pre-fetched state)
check_and_save_with_state() {
    local current_state="$1"
    
    is_state_empty "$current_state" && return
    
    # Always update cache file so immediate_save() has latest position
    printf '%s\n' "$current_state" > "$STATE_FILE"
    
    if states_changed "$current_state"; then
        # State changed - reset debounce timer
        printf '%s\n' "$EPOCHSECONDS" > /tmp/hypr-window-state-debounce
        printf '%s - State changed, starting %ss debounce\n' "$(date '+%H:%M:%S')" "$DEBOUNCE_DELAY"
        return
    fi
    
    # No change - check if debounce period has elapsed
    if [[ -f /tmp/hypr-window-state-debounce ]]; then
        local last_change
        last_change=$(< /tmp/hypr-window-state-debounce)
        local elapsed=$((EPOCHSECONDS - last_change))
        
        if ((elapsed >= DEBOUNCE_DELAY)); then
            printf '%s - Debounce period elapsed, saving rules\n' "$(date '+%H:%M:%S')"
            save_rules "$current_state"
            rm -f /tmp/hypr-window-state-debounce
        fi
    fi
}

# Legacy wrapper for backwards compatibility
check_and_save() {
    local current_state
    current_state=$(get_window_states)
    check_and_save_with_state "$current_state"
}

# Immediate save (bypass debounce) - used for critical events like window close
immediate_save() {
    local current_state
    current_state=$(get_window_states)
    
    # If no windows remain, we still want to save the state before they all closed
    # So we use the cached state if current is empty
    if is_state_empty "$current_state" && [[ -f "$STATE_FILE" ]]; then
        current_state=$(< "$STATE_FILE")
    fi
    
    is_state_empty "$current_state" && return
    
    # Always save immediately on close events - don't check if state changed
    # The window may have been moved just before closing
    printf '%s - Immediate save triggered (window close)\n' "$(date '+%H:%M:%S')"
    save_rules "$current_state"
    
    # Update hash to match saved state
    CURRENT_HASH=$(md5sum <<< "$current_state" | cut -d' ' -f1)
    rm -f /tmp/hypr-window-state-debounce
}

# Helper to check if tracked windows exist (fetches state)
has_tracked_windows() {
    local state
    state=$(get_window_states)
    ! is_state_empty "$state"
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
echo "Poll rate: Adaptive based on system load (0.25s-0.5s)"
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

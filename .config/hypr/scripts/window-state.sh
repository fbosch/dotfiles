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
CURRENT_HASH=""  # Memory cache for state hash
PATTERN_CACHE=""  # Cache for compiled regex pattern
declare -A RULES_CACHE  # Cache for existing rules (class -> rules mapping)
declare -a MATCHER_PATTERNS=()  # Array of matcher:pattern pairs

# Load window patterns from config (new format: "matcher pattern")
load_patterns() {
    [[ ! -f "$CONFIG_FILE" ]] && return 1
    # Use grep for small files (faster than rg due to lower startup overhead)
    grep -v '^#' "$CONFIG_FILE" | grep -v '^[[:space:]]*$'
}

# Build regex pattern for matching (cached)
build_pattern() {
    # Return cached pattern if available
    [[ -n "$PATTERN_CACHE" ]] && echo "$PATTERN_CACHE" && return
    
    # Build and cache pattern (pure bash, no paste)
    local patterns
    mapfile -t patterns < <(load_patterns)
    
    # Join with pipe separator
    local IFS='|'
    PATTERN_CACHE="${patterns[*]}"
    echo "$PATTERN_CACHE"
}

# Parse config and build matcher array
parse_matchers() {
    MATCHER_PATTERNS=()
    
    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        
        # Parse "matcher pattern" format (e.g., "match:class Mullvad VPN")
        if [[ "$line" =~ ^(match:[a-zA-Z_]+)[[:space:]]+(.+)$ ]]; then
            local matcher="${BASH_REMATCH[1]}"
            local pattern="${BASH_REMATCH[2]}"
            MATCHER_PATTERNS+=("$matcher|$pattern")
        fi
    done < <(load_patterns)
}

# Reload pattern cache (called when config changes)
reload_pattern_cache() {
    local patterns
    mapfile -t patterns < <(load_patterns)
    local IFS='|'
    PATTERN_CACHE="${patterns[*]}"
    parse_matchers
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

# Get current window states as JSON (with monitor-relative coordinates)
get_window_states() {
    # Parse matchers if not already done
    if ((${#MATCHER_PATTERNS[@]} == 0)); then
        parse_matchers
    fi
    
    [[ ${#MATCHER_PATTERNS[@]} -eq 0 ]] && echo "[]" && return
    
    # Build matcher array for jq using jq itself to ensure proper JSON encoding
    local matchers_json="[]"
    for entry in "${MATCHER_PATTERNS[@]}"; do
        local matcher="${entry%%|*}"
        local pattern="${entry#*|}"
        
        # Map matcher to JSON field
        local field=""
        case "$matcher" in
            match:class) field="class" ;;
            match:title) field="title" ;;
            match:initialClass|match:initial_class) field="initialClass" ;;
            match:initialTitle|match:initial_title) field="initialTitle" ;;
            *) continue ;;
        esac
        
        # Use jq to build properly escaped JSON
        matchers_json=$(jq -nc --arg field "$field" --arg pattern "$pattern" --arg matcher "$matcher" \
            --argjson existing "$matchers_json" \
            '$existing + [{field: $field, pattern: $pattern, matcher: $matcher}]')
    done
    
    # Get monitors info and clients in parallel, then combine with jq
    local monitors clients
    monitors=$(hyprctl monitors -j)
    clients=$(hyprctl clients -j)
    
    jq -c --argjson matchers "$matchers_json" --argjson monitors "$monitors" '
        ($monitors | map({id: .id, x: .x, y: .y, width: .width, height: .height}) | INDEX(.id)) as $mon_map |
        [.[] | select(.floating) |
        . as $window |
        select(
            ($matchers | map(
                . as $m | 
                $window |
                if $m.field == "class" then .class
                elif $m.field == "title" then .title
                elif $m.field == "initialClass" then .initialClass
                elif $m.field == "initialTitle" then .initialTitle
                else empty
                end | test($m.pattern)
            ) | any)
        ) |
        ($mon_map[.monitor | tostring] // {x: 0, y: 0}) as $mon |
        ($matchers | map(
            . as $m |
            $window |
            (if $m.field == "class" then .class
            elif $m.field == "title" then .title
            elif $m.field == "initialClass" then .initialClass
            elif $m.field == "initialTitle" then .initialTitle
            else empty
            end | test($m.pattern)) |
            if . then $m else empty end
        ) | first) as $matched |
        {
            class: .class,
            matcher: $matched.matcher,
            pattern: $matched.pattern,
            monitor: .monitor,
            x: (.at[0] - $mon.x),
            y: (.at[1] - $mon.y),
            width: .size[0],
            height: .size[1]
        }] | sort_by(.class)
    ' <<< "$clients"
}

# Check if any tracked floating windows exist (checks if state is non-empty)
is_state_empty() {
    local state="$1"
    [[ -z "$state" || "$state" == "[]" ]]
}

# Adaptive sleep based on system load
adaptive_sleep() {
    # Read load average directly (pure bash, no awk)
    local load rest
    read load rest < /proc/loadavg
    
    # Convert float to integer for comparison (e.g., "1.23" -> "123")
    local load_int="${load//./}"  # Remove decimal point
    local threshold=$((CPU_COUNT * 100))
    
    # Handle leading zeros (e.g., "0.5" -> "05" -> "5")
    load_int=$((10#$load_int))
    
    if ((load_int > threshold)); then
        sleep 0.5  # System busy - poll slower but still responsive
    else
        sleep 0.25  # System idle - poll very fast to catch quick window closes
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
                printf '%s - No tracked windows, stopping poll\n' "$(printf '%(%H:%M:%S)T' -1)"
                exit 0
            fi
            
            # Pass state to avoid re-fetching
            check_and_save_with_state "$current_state"
            adaptive_sleep
        done
    } &
    
    POLL_PID=$!
    printf '%s - Started polling (PID: %s)\n' "$(printf '%(%H:%M:%S)T' -1)" "$POLL_PID"
}

# Stop polling subprocess
stop_polling() {
    if [[ -n "$POLL_PID" ]]; then
        if kill -0 "$POLL_PID" 2>/dev/null; then
            kill "$POLL_PID" 2>/dev/null
            printf '%s - Stopped polling (PID: %s)\n' "$(printf '%(%H:%M:%S)T' -1)" "$POLL_PID"
        fi
        POLL_PID=""
    fi
}

# Check if window states changed (using cksum for speed)
states_changed() {
    local new_state="$1"
    local new_hash
    
    # Generate hash using md5sum (slightly faster than cksum in practice)
    new_hash=$(md5sum <<< "$new_state" | cut -d' ' -f1)
    
    # Compare with cached hash (in memory)
    if [[ "$new_hash" != "$CURRENT_HASH" ]]; then
        CURRENT_HASH="$new_hash"
        return 0
    fi
    
    return 1
}

# Load existing rules into cache
load_rules_cache() {
    RULES_CACHE=()  # Clear cache
    
    [[ ! -f "$RULES_FILE" || ! -s "$RULES_FILE" ]] && return
    
    local current_key=""
    while IFS= read -r line; do
        # Match class comments like "# match:class org.gnome.TextEditor"
        if [[ "$line" =~ ^#\ (match:[a-zA-Z]+)\ (.+)$ ]]; then
            current_key="${BASH_REMATCH[1]} ${BASH_REMATCH[2]}"
        elif [[ -n "$current_key" ]] && [[ -n "$line" ]]; then
            # Store rules for this key (skip empty lines)
            if [[ -z "${RULES_CACHE[$current_key]}" ]]; then
                RULES_CACHE[$current_key]="$line"
            else
                RULES_CACHE[$current_key]+=$'\n'"$line"
            fi
        fi
    done < "$RULES_FILE"
}

# Update or add rules for specific window classes (preserves existing rules)
update_rules() {
    local windows="$1"
    
    [[ -z "$windows" || "$windows" == "[]" ]] && return
    
    # Load existing rules into cache if empty
    if ((${#RULES_CACHE[@]} == 0)); then
        load_rules_cache
    fi
    
    # Update rules for currently open windows
    while IFS='|' read -r class matcher pattern monitor x y width height; do
        [[ -z "$class" ]] && continue
        
        # Create unique key for this matcher+pattern combo
        local key="$matcher $pattern"
        
        # Escape pattern for regex (simple escape for common cases)
        local escaped_pattern="$pattern"
        # Only escape if pattern contains regex special chars (except spaces)
        if [[ "$pattern" =~ [\.\[\]()*+?] ]]; then
            # Pattern contains regex - use as-is
            escaped_pattern="$pattern"
        else
            # Plain text - just add anchors, don't escape dots in spaces
            escaped_pattern="^${pattern}$"
        fi
        
        # Update rules for this matcher (using monitor-relative coordinates)
        # Include monitor specifier to ensure window appears on correct monitor
        RULES_CACHE[$key]=$(printf 'windowrulev2 = size %s %s, %s (%s)\nwindowrulev2 = move %s %s, %s (%s)\nwindowrulev2 = monitor %s, %s (%s)' \
            "$width" "$height" "$matcher" "$escaped_pattern" "$x" "$y" "$matcher" "$escaped_pattern" "$monitor" "$matcher" "$escaped_pattern")
        
        printf '%s - Updated %s "%s": %sx%s at (%s,%s) on monitor %s\n' "$(printf '%(%H:%M:%S)T' -1)" "$matcher" "$pattern" "$width" "$height" "$x" "$y" "$monitor"
    done < <(jq -r '.[] | "\(.class)|\(.matcher)|\(.pattern)|\(.monitor)|\(.x)|\(.y)|\(.width)|\(.height)"' <<< "$windows")
    
    # Write all rules (existing + updated) to new file
    local temp_file=$(mktemp)
    {
        printf '# Auto-generated window state persistence rules\n'
        printf '# Last updated: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
        printf '# Config: %s\n' "$CONFIG_FILE"
        printf '# DO NOT EDIT MANUALLY - This file is managed by window-state.sh\n'
        printf '\n'
    } > "$temp_file"
    
    # Write rules for all keys (sorted)
    # First, create a sorted array of keys to avoid word-splitting issues
    local -a sorted_keys
    IFS=$'\n' read -r -d '' -a sorted_keys < <(printf '%s\n' "${!RULES_CACHE[@]}" | sort && printf '\0')
    
    for key in "${sorted_keys[@]}"; do
        {
            printf '# %s\n' "$key"
            printf '%s\n' "${RULES_CACHE[$key]}"
            printf '\n'
        } >> "$temp_file"
    done
    
    # Atomically replace rules file
    mv "$temp_file" "$RULES_FILE"
    
    # Save state cache
    printf '%s\n' "$windows" > "$STATE_FILE"
    
    # Reload config
    hyprctl reload config-only &>/dev/null
    printf '%s - Config reloaded\n' "$(printf '%(%H:%M:%S)T' -1)"
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
        printf '%s - State changed, starting %ss debounce\n' "$(printf '%(%H:%M:%S)T' -1)" "$DEBOUNCE_DELAY"
        return
    fi
    
    # No change - check if debounce period has elapsed
    if [[ -f /tmp/hypr-window-state-debounce ]]; then
        local last_change
        last_change=$(< /tmp/hypr-window-state-debounce)
        local elapsed=$((EPOCHSECONDS - last_change))
        
        if ((elapsed >= DEBOUNCE_DELAY)); then
            printf '%s - Debounce period elapsed, saving rules\n' "$(printf '%(%H:%M:%S)T' -1)"
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
    printf '%s - Immediate save triggered (window close)\n' "$(printf '%(%H:%M:%S)T' -1)"
    save_rules "$current_state"
    
    # Update hash to match saved state (use md5sum to match states_changed())
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
            # Call get_window_states once and reuse
            local state
            state=$(get_window_states)
            
            if ! is_state_empty "$state"; then
                start_polling
                check_and_save_with_state "$state"
            fi
            ;;
        closewindow*)
            # Window closed - save immediately to capture last position
            immediate_save
            
            # Check if we should stop polling (reuse state from after close)
            local state
            state=$(get_window_states)
            
            if ! is_state_empty "$state"; then
                check_and_save_with_state "$state"
            else
                stop_polling
            fi
            ;;
        movewindowv2*)
            # Window moved to different workspace - might need to update or stop tracking
            local state
            state=$(get_window_states)
            
            if ! is_state_empty "$state"; then
                check_and_save_with_state "$state"
            else
                stop_polling
            fi
            ;;
        configreloaded*)
            # Config reloaded - reload caches and recheck what we're tracking
            reload_pattern_cache
            load_rules_cache
            
            local state
            state=$(get_window_states)
            
            if ! is_state_empty "$state"; then
                start_polling
                check_and_save_with_state "$state"
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
parse_matchers  # Parse matchers on startup

# Check if we need to start polling immediately
if has_tracked_windows; then
    echo "$(printf '%(%H:%M:%S)T' -1) - Tracked windows detected, starting poll"
    start_polling
    check_and_save
else
    echo "$(printf '%(%H:%M:%S)T' -1) - No tracked windows, idle (waiting for events)"
fi

# Cleanup handler
cleanup() {
    echo "$(printf '%(%H:%M:%S)T' -1) - Shutting down..."
    stop_polling
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# Listen to Hyprland events
socat -U - "UNIX-CONNECT:$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock" | \
while IFS= read -r line; do
    handle_event "$line"
done

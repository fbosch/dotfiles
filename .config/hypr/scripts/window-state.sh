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
STATE_FILE="${XDG_RUNTIME_DIR}/hypr-window-state.cache"
DEBOUNCE_FILE="${XDG_RUNTIME_DIR}/hypr-window-state-debounce"
DEBOUNCE_DELAY=1      # Wait 1 second after last change before saving
POLL_INTERVAL_IDLE=0.05   # Poll interval when system is idle
POLL_INTERVAL_BUSY=0.15   # Poll interval when system load is high
POLL_PID=""  # Track polling subprocess
MAIN_PID=$$  # PID of main process (for subprocess signalling)
CPU_COUNT=$(nproc)  # Number of CPU cores for load calculation
CURRENT_HASH=""   # Last seen state string (for change detection)
MATCHERS_JSON=""  # Cached JSON representation of MATCHER_PATTERNS (invalidated by parse_matchers)
MONITORS_JSON=""  # Cached monitor layout (invalidated by monitoradded/monitorremoved events)
declare -A RULES_CACHE  # Cache for existing rules (class -> rules mapping)
declare -a MATCHER_PATTERNS=()  # Array of matcher:pattern pairs

# Parse config and build matcher array
parse_matchers() {
    MATCHER_PATTERNS=()
    MATCHERS_JSON=""  # invalidate cached JSON

    [[ ! -f "$CONFIG_FILE" ]] && return

    while IFS= read -r line; do
        # Parse "matcher pattern" format (e.g., "match:class Mullvad VPN")
        if [[ "$line" =~ ^(match:[a-zA-Z_]+)[[:space:]]+(.+)$ ]]; then
            MATCHER_PATTERNS+=("${BASH_REMATCH[1]}|${BASH_REMATCH[2]}")
        fi
    done < <(grep -Ev '^[[:space:]]*(#|$)' "$CONFIG_FILE")
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

# Fetch and cache monitor layout (cheap — called once at startup and on monitor change)
fetch_monitors() {
    MONITORS_JSON=$(printf 'j/monitors' | nc -U "$HYPR_QUERY_SOCKET" 2>/dev/null) || {
        printf 'ERROR: monitors query failed\n' >&2
        return 1
    }
}

# Get current window states as JSON (with monitor-relative coordinates)
get_window_states() {
    # Parse matchers if not already done
    if ((${#MATCHER_PATTERNS[@]} == 0)); then
        parse_matchers
    fi
    
    [[ ${#MATCHER_PATTERNS[@]} -eq 0 ]] && echo "[]" && return
    
    # Build matcher JSON once and cache it (invalidated by parse_matchers)
    if [[ -z "$MATCHERS_JSON" ]]; then
        local -a jq_args=()
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
            
            jq_args+=("${matcher}|${pattern}|${field}")
        done
        
        MATCHERS_JSON=$(jq -nc '$ARGS.positional | map(
            split("|") | {matcher: .[0], pattern: .[1], field: .[2]}
        )' --args "${jq_args[@]}")
    fi
    local matchers_json="$MATCHERS_JSON"
    
    # Get clients; monitors come from cache (invalidated by monitoradded/monitorremoved)
    local clients
    clients=$(printf 'j/clients' | nc -U "$HYPR_QUERY_SOCKET" 2>/dev/null) || { printf 'ERROR: clients query failed\n' >&2; echo "[]"; return 1; }

    jq -c --argjson matchers "$matchers_json" --argjson monitors "$MONITORS_JSON" '
        def field_of(w; m): w | if   m.field == "class"        then .class
                                 elif m.field == "title"        then .title
                                 elif m.field == "initialClass" then .initialClass
                                 elif m.field == "initialTitle" then .initialTitle
                                 else empty end;
        ($monitors | map({id, name, x, y}) | INDEX(.id)) as $mon_map |
        [.[] | select(.floating) |
        . as $w |
        first($matchers[] | . as $m | select(field_of($w; $m) | test($m.pattern))) as $matched |
        ($mon_map[$w.monitor | tostring] // {name: "", x: 0, y: 0}) as $mon |
        {
            class: $w.class,
            matcher: $matched.matcher,
            pattern: $matched.pattern,
            monitor: $mon.name,
            x: ($w.at[0] - $mon.x),
            y: ($w.at[1] - $mon.y),
            width: $w.size[0],
            height: $w.size[1]
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
    read -r load rest < /proc/loadavg
    
    # Convert float to integer for comparison (e.g., "1.23" -> "123")
    local load_int="${load//./}"  # Remove decimal point
    local threshold=$((CPU_COUNT * 100))
    
    # Handle leading zeros (e.g., "0.5" -> "05" -> "5")
    load_int=$((10#$load_int))
    
    if ((load_int > threshold)); then
        sleep "$POLL_INTERVAL_BUSY"
    else
        sleep "$POLL_INTERVAL_IDLE"
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
                kill -USR1 "$MAIN_PID" 2>/dev/null
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
            wait "$POLL_PID" 2>/dev/null
            printf '%s - Stopped polling (PID: %s)\n' "$(printf '%(%H:%M:%S)T' -1)" "$POLL_PID"
        fi
        POLL_PID=""
    fi
}

# Check if window states changed (direct string comparison)
states_changed() {
    local new_state="$1"
    
    # Compare state string directly - faster than md5sum subprocess for small payloads
    if [[ "$new_state" != "$CURRENT_HASH" ]]; then
        CURRENT_HASH="$new_state"
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
        if [[ "$line" =~ ^#\ (match:[a-zA-Z_]+)\ (.+)$ ]]; then
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
        
        # Build windowrule pattern: plain text gets anchored, regex used as-is
        local escaped_pattern
        if [[ "$pattern" =~ [\.\[\]()*+?^$] ]]; then
            # Already contains regex syntax - use as-is
            escaped_pattern="$pattern"
        else
            # Plain text - anchor to prevent partial matches
            escaped_pattern="^${pattern}$"
        fi
        
        # Update rules for this matcher (monitor rule first, then size/move)
        local rules
        rules=$(printf 'windowrule = size %s %s, %s (%s)\nwindowrule = move %s %s, %s (%s)' \
            "$width" "$height" "$matcher" "$escaped_pattern" "$x" "$y" "$matcher" "$escaped_pattern")
        if [[ -n "$monitor" ]]; then
            rules=$(printf 'windowrule = %s (%s), monitor %s\n%s' "$matcher" "$escaped_pattern" "$monitor" "$rules")
        fi
        RULES_CACHE[$key]="$rules"
        
        printf '%s - Updated %s "%s": %sx%s at (%s,%s) on %s\n' "$(printf '%(%H:%M:%S)T' -1)" "$matcher" "$pattern" "$width" "$height" "$x" "$y" "${monitor:-unknown}"
    done < <(jq -r '.[] | "\(.class)|\(.matcher)|\(.pattern)|\(.monitor)|\(.x)|\(.y)|\(.width)|\(.height)"' <<< "$windows")
    
    # Write all rules (existing + updated) to new file
    local temp_file
    temp_file=$(mktemp) || { printf 'ERROR: Failed to create temp file\n' >&2; return 1; }
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
    if ! mv "$temp_file" "$RULES_FILE"; then
        printf 'ERROR: Failed to update rules file\n' >&2
        rm -f "$temp_file"
        return 1
    fi
    
    # Save state cache
    printf '%s\n' "$windows" > "$STATE_FILE"
    
    # Reload config
    hyprctl reload config-only &>/dev/null
    printf '%s - Config reloaded\n' "$(printf '%(%H:%M:%S)T' -1)"
}


# Debounced check and save (accepts pre-fetched state)
check_and_save_with_state() {
    local current_state="$1"
    
    is_state_empty "$current_state" && return
    
    if states_changed "$current_state"; then
        # State changed - update cache file and reset debounce timer
        printf '%s\n' "$current_state" > "$STATE_FILE"
        printf '%s\n' "$EPOCHSECONDS" > "$DEBOUNCE_FILE"
        printf '%s - State changed, starting %ss debounce\n' "$(printf '%(%H:%M:%S)T' -1)" "$DEBOUNCE_DELAY"
        return
    fi
    
    # No change - check if debounce period has elapsed
    if [[ -f "$DEBOUNCE_FILE" ]]; then
        local last_change
        last_change=$(< "$DEBOUNCE_FILE")
        local elapsed=$((EPOCHSECONDS - last_change))
        
        if ((elapsed >= DEBOUNCE_DELAY)); then
            printf '%s - Debounce period elapsed, saving rules\n' "$(printf '%(%H:%M:%S)T' -1)"
            update_rules "$current_state"
            rm -f "$DEBOUNCE_FILE"
        fi
    fi
}


# Immediate save (bypass debounce) - used for critical events like window close
# Prints the fetched state to stdout so callers can reuse it without re-fetching
immediate_save() {
    local current_state
    current_state=$(get_window_states)
    
    printf '%s\n' "$current_state"

    is_state_empty "$current_state" && return
    
    # Always save immediately on close events - don't check if state changed
    # The window may have been moved just before closing
    printf '%s - Immediate save triggered (window close)\n' "$(printf '%(%H:%M:%S)T' -1)"
    update_rules "$current_state"
    
    # Sync hash so states_changed() doesn't re-trigger after immediate save
    CURRENT_HASH="$current_state"
    rm -f "$DEBOUNCE_FILE"
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
            # Window closed - save immediately; reuse the fetched state
            local state
            state=$(immediate_save)
            
            if ! is_state_empty "$state"; then
                check_and_save_with_state "$state"
            else
                stop_polling
            fi
            ;;
        configreloaded*)
            # Config reloaded - reload caches and recheck what we're tracking
            parse_matchers
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
        monitoradded*|monitorremoved*)
            # Monitor topology changed - refresh cached monitor layout
            fetch_monitors
            ;;
    esac
}

# Main

# Validate Hyprland environment
if [[ -z "$HYPRLAND_INSTANCE_SIGNATURE" ]]; then
    printf 'ERROR: HYPRLAND_INSTANCE_SIGNATURE is not set (not running under Hyprland?)\n' >&2
    exit 1
fi
HYPR_SOCKET="$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock"
HYPR_QUERY_SOCKET="$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket.sock"
if [[ ! -S "$HYPR_SOCKET" ]]; then
    printf 'ERROR: Hyprland event socket not found: %s\n' "$HYPR_SOCKET" >&2
    exit 1
fi
if [[ ! -S "$HYPR_QUERY_SOCKET" ]]; then
    printf 'ERROR: Hyprland query socket not found: %s\n' "$HYPR_QUERY_SOCKET" >&2
    exit 1
fi

echo "Window state persistence started (event-driven + adaptive polling)"
echo "Config: $CONFIG_FILE"
echo "Rules: $RULES_FILE"
echo "Debounce delay: ${DEBOUNCE_DELAY}s"
echo "Scheduling: SCHED_IDLE (runs only when CPU is idle)"
echo "Poll rate: Adaptive based on system load (0.05s-0.15s)"
echo ""

init_rules_file
parse_matchers  # Parse matchers on startup
fetch_monitors  # Cache monitor layout

# Check if we need to start polling immediately (single fetch, reused below)
initial_state=$(get_window_states)
if ! is_state_empty "$initial_state"; then
    echo "$(printf '%(%H:%M:%S)T' -1) - Tracked windows detected, starting poll"
    start_polling
    check_and_save_with_state "$initial_state"
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
trap 'wait "$POLL_PID" 2>/dev/null; POLL_PID=""' USR1

# Listen to Hyprland events
socat -U - "UNIX-CONNECT:$HYPR_SOCKET" | \
while IFS= read -r line; do
    handle_event "$line"
done

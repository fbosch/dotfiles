#!/usr/bin/env bash
# Window State Persistence for Hyprland
# Uses hybrid approach: socket2 events + conditional polling (only when needed)

# shellcheck disable=SC1091
source "${HOME}/.config/hypr/runtime/lib/hypr-ipc.sh"

# Re-exec with SCHED_IDLE scheduling if not already running with it
if [[ -z "${WINDOW_STATE_IDLE_SCHED}" ]]; then
    if command -v chrt &>/dev/null; then
        export WINDOW_STATE_IDLE_SCHED=1
        exec chrt -i 0 "$0" "$@"
    fi
fi

LOCK_FILE="${XDG_RUNTIME_DIR}/hypr-window-state.lock"
exec 9>"$LOCK_FILE"
if command -v flock &>/dev/null; then
    if flock -n 9; then
        :
    else
        printf 'Window state persistence already running, exiting\n' >&2
        exit 0
    fi
fi

SELECTORS_LUA_FILE="$HOME/.config/hypr/rules/window-state-selectors.lua"
RULES_LUA_FILE="$HOME/.config/hypr/rules/window-state.lua"
STATE_FILE="${XDG_RUNTIME_DIR}/hypr-window-state.cache"
DEBOUNCE_FILE="${XDG_RUNTIME_DIR}/hypr-window-state-debounce"
DEBOUNCE_DELAY=1      # Wait 1 second after last change before saving
POLL_INTERVAL_ACTIVE_IDLE=0.05   # Poll interval while geometry is changing and CPU is idle
POLL_INTERVAL_ACTIVE_BUSY=0.15   # Poll interval while geometry is changing and CPU is busy
POLL_INTERVAL_STABLE_IDLE=1      # Poll interval after tracked windows are stable
POLL_INTERVAL_STABLE_BUSY=1.5    # Poll interval after tracked windows are stable and CPU is busy
POLL_PID=""  # Track polling subprocess
MAIN_PID=$$  # PID of main process (for subprocess signalling)
CPU_COUNT=$(nproc)  # Number of CPU cores for load calculation
CURRENT_HASH=""   # Last seen state string (for change detection)
MATCHERS_JSON=""  # Cached JSON representation of MATCHER_PATTERNS (invalidated by parse_selectors)
MONITORS_JSON=""  # Cached monitor layout (invalidated by monitoradded/monitorremoved events)
RULES_FILE_CHANGED=0  # Whether the last generated rules write changed the file
declare -A RULES_CACHE  # Cache for existing rules (class -> rules mapping)
declare -a MATCHER_PATTERNS=()  # Array of matcher:pattern pairs

# Parse Lua selector source and build matcher array.
parse_selectors() {
    MATCHER_PATTERNS=()
    MATCHERS_JSON=""  # invalidate cached JSON
    local selector_re='matcher[[:space:]]*=[[:space:]]*"(match:[a-zA-Z_]+)"[[:space:]]*,[[:space:]]*pattern[[:space:]]*=[[:space:]]*\[=\[(.*)\]=\]'

    [[ ! -f "$SELECTORS_LUA_FILE" ]] && return

    while IFS= read -r line; do
        if [[ "$line" =~ $selector_re ]]; then
            MATCHER_PATTERNS+=("${BASH_REMATCH[1]}|${BASH_REMATCH[2]}")
        fi
    done < "$SELECTORS_LUA_FILE"
}

lua_quote() {
    jq -Rn --arg value "$1" '$value'
}

matcher_to_lua_key() {
    case "$1" in
        match:class) printf 'class' ;;
        match:title) printf 'title' ;;
        match:initialClass|match:initial_class) printf 'initial_class' ;;
        match:initialTitle|match:initial_title) printf 'initial_title' ;;
        *) return 1 ;;
    esac
}

window_state_lua_id() {
    printf 'window-state:%s:%s' "$1" "$2"
}

pattern_is_regex() {
    local pattern="$1"

    [[ "$pattern" == *"."* \
        || "$pattern" == *"["* \
        || "$pattern" == *"]"* \
        || "$pattern" == *"("* \
        || "$pattern" == *")"* \
        || "$pattern" == *"*"* \
        || "$pattern" == *"+"* \
        || "$pattern" == *"?"* \
        || "$pattern" == *"^"* \
        || "$pattern" == *'$'* ]]
}

window_state_rule_pattern() {
    local pattern="$1"

    if pattern_is_regex "$pattern"; then
        printf '%s' "$pattern"
    else
        printf '^%s$' "$pattern"
    fi
}

# Fetch and cache monitor layout (cheap — called once at startup and on monitor change)
fetch_monitors() {
    MONITORS_JSON=$(hypr_query 'j/monitors') || {
        printf 'ERROR: monitors query failed\n' >&2
        return 1
    }
}

# Get current window states as JSON (with monitor-relative coordinates)
get_window_states() {
    # Parse selectors if not already done
    if ((${#MATCHER_PATTERNS[@]} == 0)); then
        parse_selectors
    fi
    
    [[ ${#MATCHER_PATTERNS[@]} -eq 0 ]] && echo "[]" && return
    
    # Build matcher JSON once and cache it (invalidated by parse_selectors)
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
    clients=$(hypr_query 'j/clients') || { printf 'ERROR: clients query failed\n' >&2; echo "[]"; return 1; }

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

# Adaptive sleep based on system load and recent window activity
adaptive_sleep() {
    local mode="${1:-active}"

    # Read load average directly (pure bash, no awk)
    local load rest
    read -r load rest < /proc/loadavg
    
    # Convert float to integer for comparison (e.g., "1.23" -> "123")
    local load_int="${load//./}"  # Remove decimal point
    local threshold=$((CPU_COUNT * 100))
    
    # Handle leading zeros (e.g., "0.5" -> "05" -> "5")
    load_int=$((10#$load_int))
    
    if [[ "$mode" == "stable" ]]; then
        if ((load_int > threshold)); then
            sleep "$POLL_INTERVAL_STABLE_BUSY"
        else
            sleep "$POLL_INTERVAL_STABLE_IDLE"
        fi
        return
    fi

    if ((load_int > threshold)); then
        sleep "$POLL_INTERVAL_ACTIVE_BUSY"
    else
        sleep "$POLL_INTERVAL_ACTIVE_IDLE"
    fi
}

# Start polling subprocess
start_polling() {
    # Don't start if already polling
    [[ -n "$POLL_PID" ]] && kill -0 "$POLL_PID" 2>/dev/null && return
    
    {
        while true; do
            # Get window states once per iteration
            local current_state previous_hash had_debounce sleep_mode
            previous_hash="$CURRENT_HASH"
            had_debounce=0
            [[ -f "$DEBOUNCE_FILE" ]] && had_debounce=1

            current_state=$(get_window_states)
            
            # Check if we should stop (no tracked windows)
            if is_state_empty "$current_state"; then
                printf '%s - No tracked windows, stopping poll\n' "$(printf '%(%H:%M:%S)T' -1)"
                kill -USR1 "$MAIN_PID" 2>/dev/null
                exit 0
            fi
            
            # Pass state to avoid re-fetching
            check_and_save_with_state "$current_state"

            sleep_mode="stable"
            if [[ "$current_state" != "$previous_hash" || $had_debounce -eq 1 || -f "$DEBOUNCE_FILE" ]]; then
                sleep_mode="active"
            fi

            adaptive_sleep "$sleep_mode"
        done
    } 9>&- &
    
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

rules_for_window_state() {
    local matcher="$1"
    local pattern="$2"
    local monitor="$3"
    local x="$4"
    local y="$5"
    local width="$6"
    local height="$7"

    local rule_pattern
    rule_pattern=$(window_state_rule_pattern "$pattern")

    local rules
    rules=$(printf 'windowrule = size %s %s, %s (%s)\nwindowrule = move %s %s, %s (%s)' \
        "$width" "$height" "$matcher" "$rule_pattern" "$x" "$y" "$matcher" "$rule_pattern")
    if [[ -n "$monitor" ]]; then
        rules=$(printf 'windowrule = %s (%s), monitor %s\n%s' "$matcher" "$rule_pattern" "$monitor" "$rules")
    fi

    printf '%s\n' "$rules"
}

# Load existing generated Lua rules into cache so closed windows survive restarts.
load_rules_cache() {
    RULES_CACHE=()

    [[ ! -f "$RULES_LUA_FILE" || ! -s "$RULES_LUA_FILE" ]] && return

    local current_key=""
    local monitor=""
    local width=""
    local height=""
    local x=""
    local y=""

    flush_lua_rule_cache_entry() {
        [[ -z "$current_key" || -z "$width" || -z "$height" || -z "$x" || -z "$y" ]] && return

        local matcher="${current_key%% *}"
        local pattern="${current_key#* }"
        RULES_CACHE[$current_key]=$(rules_for_window_state "$matcher" "$pattern" "$monitor" "$x" "$y" "$width" "$height")
    }

    while IFS= read -r line; do
        if [[ "$line" =~ ^[[:space:]]*--[[:space:]](match:[a-zA-Z_]+)[[:space:]](.+)$ ]]; then
            flush_lua_rule_cache_entry
            current_key="${BASH_REMATCH[1]} ${BASH_REMATCH[2]}"
            monitor=""
            width=""
            height=""
            x=""
            y=""
        elif [[ "$line" =~ monitor[[:space:]]*=[[:space:]]*\"([^\"]+)\" ]]; then
            monitor="${BASH_REMATCH[1]}"
        elif [[ "$line" =~ size[[:space:]]*=[[:space:]]*\{[[:space:]]*([0-9]+)[[:space:]]*,[[:space:]]*([0-9]+)[[:space:]]*\} ]]; then
            width="${BASH_REMATCH[1]}"
            height="${BASH_REMATCH[2]}"
        elif [[ "$line" =~ move[[:space:]]*=[[:space:]]*\{[[:space:]]*(-?[0-9]+)[[:space:]]*,[[:space:]]*(-?[0-9]+)[[:space:]]*\} ]]; then
            x="${BASH_REMATCH[1]}"
            y="${BASH_REMATCH[2]}"
        fi
    done < "$RULES_LUA_FILE"

    flush_lua_rule_cache_entry
    unset -f flush_lua_rule_cache_entry
}

# Remove cached rules whose matcher+pattern no longer exists in config
prune_stale_rules_cache() {
    local -A valid_keys=()

    for entry in "${MATCHER_PATTERNS[@]}"; do
        local matcher="${entry%%|*}"
        local pattern="${entry#*|}"
        valid_keys["$matcher $pattern"]=1
    done

    for key in "${!RULES_CACHE[@]}"; do
        if [[ -z "${valid_keys[$key]}" ]]; then
            unset 'RULES_CACHE[$key]'
        fi
    done
}

write_lua_rules_cache_file() {
    mkdir -p "$(dirname "$RULES_LUA_FILE")"
    RULES_FILE_CHANGED=0

    local temp_file
    temp_file=$(mktemp) || { printf 'ERROR: Failed to create temp file\n' >&2; return 1; }

    {
        printf '%s\n' '-- Auto-generated Lua window state persistence rules'
        printf '%s\n' "-- Selectors: $SELECTORS_LUA_FILE"
        printf '%s\n' '-- DO NOT EDIT MANUALLY - This file is managed by window-state.sh'
        printf '\nreturn {\n'
    } > "$temp_file"

    local -a sorted_keys
    IFS=$'\n' read -r -d '' -a sorted_keys < <(printf '%s\n' "${!RULES_CACHE[@]}" | sort && printf '\0')

    for key in "${sorted_keys[@]}"; do
        local matcher="${key%% *}"
        local pattern="${key#* }"
        local lua_match_key

        lua_match_key=$(matcher_to_lua_key "$matcher") || continue

        local rule_pattern
        rule_pattern=$(window_state_rule_pattern "$pattern")

        local rules="${RULES_CACHE[$key]}"
        local monitor=""
        local width=""
        local height=""
        local x=""
        local y=""

        while IFS= read -r rule_line; do
            if [[ "$rule_line" =~ monitor[[:space:]]+(.+)$ ]]; then
                monitor="${BASH_REMATCH[1]}"
            elif [[ "$rule_line" =~ size[[:space:]]+([0-9]+)[[:space:]]+([0-9]+), ]]; then
                width="${BASH_REMATCH[1]}"
                height="${BASH_REMATCH[2]}"
            elif [[ "$rule_line" =~ move[[:space:]]+(-?[0-9]+)[[:space:]]+(-?[0-9]+), ]]; then
                x="${BASH_REMATCH[1]}"
                y="${BASH_REMATCH[2]}"
            fi
        done <<< "$rules"

        {
            printf '  -- %s\n' "$key"
            printf '  {\n'
            printf '    id = %s,\n' "$(lua_quote "$(window_state_lua_id "$matcher" "$pattern")")"
            printf '    match = {\n'
            printf '      %s = %s,\n' "$lua_match_key" "$(lua_quote "$rule_pattern")"
            printf '    },\n'
            printf '    effects = {\n'
            if [[ -n "$monitor" ]]; then
                printf '      monitor = %s,\n' "$(lua_quote "$monitor")"
            fi
            if [[ -n "$width" && -n "$height" ]]; then
                printf '      size = { %s, %s },\n' "$width" "$height"
            fi
            if [[ -n "$x" && -n "$y" ]]; then
                printf '      move = { %s, %s },\n' "$x" "$y"
            fi
            printf '    },\n'
            printf '    source = "window-state",\n'
            printf '    comment = %s,\n' "$(lua_quote "$key")"
            printf '  },\n\n'
        } >> "$temp_file"
    done

    printf '}\n' >> "$temp_file"

    if [[ -f "$RULES_LUA_FILE" ]] && cmp -s "$temp_file" "$RULES_LUA_FILE"; then
        rm -f "$temp_file"
        return 0
    fi

    if ! mv "$temp_file" "$RULES_LUA_FILE"; then
        printf 'ERROR: Failed to update Lua window-state rules file\n' >&2
        rm -f "$temp_file"
        return 1
    fi

    RULES_FILE_CHANGED=1
}

apply_window_state_rules() {
    local config_dir lua_config_dir lua_script
    config_dir="$HOME/.config/hypr"
    lua_config_dir=$(lua_quote "$config_dir") || return 1
    lua_script=$(printf 'local config_dir = %s; package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path; require("rule-loader").apply_window_rule_phase(config_dir, "window_state")' "$lua_config_dir")

    hyprctl eval "$lua_script" &>/dev/null
}

# Update or add rules for specific window classes (preserves existing rules)
update_rules() {
    local windows="$1"
    
    [[ -z "$windows" || "$windows" == "[]" ]] && return
    
    # Load existing rules into cache if empty
    if ((${#RULES_CACHE[@]} == 0)); then
        load_rules_cache
    fi

    prune_stale_rules_cache
    
    # Update rules for currently open windows
    while IFS='|' read -r class matcher pattern monitor x y width height; do
        [[ -z "$class" ]] && continue
        
        # Create unique key for this matcher+pattern combo
        local key="$matcher $pattern"
        
        RULES_CACHE[$key]=$(rules_for_window_state "$matcher" "$pattern" "$monitor" "$x" "$y" "$width" "$height")
        
        printf '%s - Updated %s "%s": %sx%s at (%s,%s) on %s\n' "$(printf '%(%H:%M:%S)T' -1)" "$matcher" "$pattern" "$width" "$height" "$x" "$y" "${monitor:-unknown}" >&2
    done < <(jq -r '.[] | "\(.class)|\(.matcher)|\(.pattern)|\(.monitor)|\(.x)|\(.y)|\(.width)|\(.height)"' <<< "$windows")
    
    # Write all rules (existing + updated) to Lua data file
    write_lua_rules_cache_file || return 1
    
    # Save state cache
    printf '%s\n' "$windows" > "$STATE_FILE"
    
    if ((RULES_FILE_CHANGED == 0)); then
        printf '%s - Window-state rules unchanged\n' "$(printf '%(%H:%M:%S)T' -1)" >&2
        return
    fi

    # Refresh only window-state rules. Full config reload reapplies workspace
    # layout_opts and clobbers manually resized master splits.
    if apply_window_state_rules; then
        printf '%s - Window-state rules refreshed\n' "$(printf '%(%H:%M:%S)T' -1)" >&2
    else
        printf '%s - WARNING: Failed to refresh window-state rules\n' "$(printf '%(%H:%M:%S)T' -1)" >&2
    fi
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
    printf '%s - Immediate save triggered (window close)\n' "$(printf '%(%H:%M:%S)T' -1)" >&2
    update_rules "$current_state"
    
    # Sync hash so states_changed() doesn't re-trigger after immediate save
    CURRENT_HASH="$current_state"
    rm -f "$DEBOUNCE_FILE"
}


# Event handler for socket2
handle_event() {
    local event="$1"
    
    case "$event" in
        openwindow*|changefloatingmode*|movewindow*|resizewindow*)
            # Window opened, moved/resized, or changed float mode - might need to start tracking
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
            parse_selectors
            load_rules_cache
            prune_stale_rules_cache
            write_lua_rules_cache_file
            
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
if [[ ! -S "$HYPR_SOCKET" ]]; then
    printf 'ERROR: Hyprland event socket not found: %s\n' "$HYPR_SOCKET" >&2
    exit 1
fi
HYPR_QUERY_SOCKET="$(hypr_query_socket_path 2>/dev/null || true)"
if [[ -z "$HYPR_QUERY_SOCKET" || ! -S "$HYPR_QUERY_SOCKET" ]]; then
    printf 'ERROR: Hyprland query socket not found: %s\n' "${HYPR_QUERY_SOCKET:-<unset>}" >&2
    exit 1
fi

echo "Window state persistence started (event-driven + adaptive polling)"
echo "Selectors: $SELECTORS_LUA_FILE"
echo "Rules: $RULES_LUA_FILE"
echo "Debounce delay: ${DEBOUNCE_DELAY}s"
echo "Scheduling: SCHED_IDLE (runs only when CPU is idle)"
echo "Poll rate: Adaptive based on activity/load (active 0.05s-0.15s, stable 1s-1.5s)"
echo ""

parse_selectors  # Parse selectors on startup
load_rules_cache
prune_stale_rules_cache
write_lua_rules_cache_file
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
socat -U - "UNIX-CONNECT:$HYPR_SOCKET" 9>&- | \
while IFS= read -r line; do
    handle_event "$line"
done 9>&-

function first_login_of_the_day
    set -l silent 0
    if contains -- --silent $argv
        set silent 1
    end

    set -l current_date (date "+%y-%m-%d")
    set -l cache_file "/tmp/.first_login/$current_date"

    # Check in-memory cache first (fastest - no disk I/O or external processes)
    # This caches the value for the current shell session
    if test -n "$__first_login_cache_date" && test "$__first_login_cache_date" = "$current_date"
        if test $silent -eq 0
            echo "$__first_login_cache_time"
        end
        return
    end

    # Check disk cache first (fast - just file read)
    if test -f "$cache_file" && read -l cached_time <"$cache_file"
        # Cache in memory for future calls in this session
        set -g __first_login_cache_date "$current_date"
        set -g __first_login_cache_time "$cached_time"
        wezterm_set_user_var first_login "$cached_time"
        if test $silent -eq 0
            echo "$cached_time"
        end
        return
    end

    # Find first "Display is turned on" event today (most reliable wake/login indicator)
    # This works even on systems that haven't rebooted in days
    # pmset -g log is reasonably fast (~500ms) and works across sleep/wake cycles
    set -l time ""
    set -l display_on_event (pmset -g log | awk "/$current_date/ && /Display is turned on/ {print; exit}")
    
    if test -n "$display_on_event"
        # Extract time from event line (format: "2026-01-13 08:58:10 +0100 Notification ...")
        set time (string match -r '\d{2}:\d{2}:\d{2}' "$display_on_event")
    end
    
    # Fallback: Check Dock process start time (works for actual reboots/logins)
    # Note: Dock can be restarted (e.g., via Nix rebuild), making it less reliable
    if test -z "$time"
        set -l dock_pid (pgrep -u $USER -x Dock | head -n1)
        if test -n "$dock_pid"
            set -l lstart_output (ps -p $dock_pid -o lstart= 2>/dev/null)
            set time (string match -r '\d{2}:\d{2}:\d{2}' "$lstart_output")
        end
    end
    
    # Final fallback: loginwindow logs (slowest but most authoritative for real logins)
    if test -z "$time"
        set -l login_item (log show --start (date '+%Y-%m-%d 07:30:00') --predicate 'process == "loginwindow"' | grep -i "success" | head -n1)
        set time (string match -r '\d{2}:\d{2}:\d{2}\b' "$login_item")
    end

    mkdir -p (dirname "$cache_file")
    echo "$time" >"$cache_file"
    
    # Cache in memory for future calls in this session
    set -g __first_login_cache_date "$current_date"
    set -g __first_login_cache_time "$time"
    
    wezterm_set_user_var first_login "$time"

    if test $silent -eq 0
        echo "$time"
    end
end

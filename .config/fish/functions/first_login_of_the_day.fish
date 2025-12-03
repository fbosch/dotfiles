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

    # Check disk cache (fast - just file read)
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

    # NEW APPROACH: Check Dock process start time (starts at GUI login, never restarts)
    # This is ~100x faster than log show (~20ms vs ~2300ms)
    set -l time ""
    set -l dock_pid (pgrep -u $USER -x Dock | head -n1)
    
    if test -n "$dock_pid"
        # Get process start time - lstart format: "Mon Dec  3 09:06:54 2025"
        set -l lstart_output (ps -p $dock_pid -o lstart= 2>/dev/null)
        # Extract HH:MM:SS time portion
        set time (string match -r '\d{2}:\d{2}:\d{2}' "$lstart_output")
    end
    
    # Fallback to log show if Dock approach fails (shouldn't happen in normal GUI session)
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

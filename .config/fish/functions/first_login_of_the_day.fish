function first_login_of_the_day
    set -l silent 0
    if contains -- --silent $argv
        set silent 1
    end

    set -l current_date (date "+%y-%m-%d")
    set -l current_date_iso (date "+%Y-%m-%d")
    set -l cache_base "$XDG_CACHE_HOME"
    if test -z "$cache_base"
        set cache_base "$HOME/.cache"
    end
    set -l cache_file "$cache_base/first_login/$current_date"

    # Check in-memory cache first (fastest - no disk I/O or external processes)
    # This caches the value for the current shell session
    if test -n "$__first_login_cache_date" && test "$__first_login_cache_date" = "$current_date"
        if test $silent -eq 0
            echo "$__first_login_cache_time"
        end
        return
    end

    set -l time ""

    # Check disk cache first (fast - just file read)
    if test -f "$cache_file" && read -l cached_time <"$cache_file" && test -n "$cached_time"
        set time "$cached_time"
    end

    # Prefer the earliest loginwindow transition to the desktop for today.
    # This survives Dock restarts, which can otherwise skew the inferred start time.
    set -l login_item (/usr/bin/log show --style compact --start "$current_date_iso 00:00:00" --predicate 'process == "loginwindow"' 2>/dev/null | grep 'systemSetSessionState success, new state: Desktop showing' | head -n1)
    set -l loginwindow_time (string match -r '\d{2}:\d{2}:\d{2}' "$login_item")
    if test -n "$loginwindow_time"
        set time "$loginwindow_time"
    end

    # Fallback: Dock start time (typically starts with GUI login)
    if test -z "$time"
        set -l dock_pid (pgrep -u (id -u) -x Dock | head -n1)
        if test -n "$dock_pid"
            set -l lstart_output (ps -p $dock_pid -o lstart= 2>/dev/null)
            set time (string match -r '\d{2}:\d{2}:\d{2}' "$lstart_output")
        end
    end

    # Final fallback: first display-on event of the day (approximation only)
    if test -z "$time"
        set -l display_on_event (pmset -g log | awk "/$current_date_iso/ && /Display/ && /(turned on|is on)/ {print; exit}")
        if test -n "$display_on_event"
            set time (string match -r '\d{2}:\d{2}:\d{2}' "$display_on_event")
        end
    end

    if test -n "$time"
        mkdir -p (dirname "$cache_file")
        echo "$time" >"$cache_file"

        # Cache in memory for future calls in this session
        set -g __first_login_cache_date "$current_date"
        set -g __first_login_cache_time "$time"

        wezterm_set_user_var first_login "$time"
    end

    if test $silent -eq 0
        echo "$time"
    end
end

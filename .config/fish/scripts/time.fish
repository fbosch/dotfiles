# Time tracking and workday functions

function first_login_of_the_day
    set -l silent 0
    if contains -- --silent $argv
        set silent 1
    end

    set -l current_date (date "+%y-%m-%d")
    set -l cache_file "/tmp/.first_login/$current_date"

    if test -f "$cache_file" && read -l cached_time <"$cache_file"
        wezterm_set_user_var first_login "$cached_time"
        if test $silent -eq 0
            echo "$cached_time"
        end
        return
    end

    set -l login_item (log show --start (date '+%Y-%m-%d 07:30:00') --predicate 'process == "loginwindow"' | grep -i "success" | head -n1)

    set -l time (string match -r '\d{2}:\d{2}:\d{2}\b' "$login_item")

    mkdir -p (dirname "$cache_file")
    echo "$time" >"$cache_file"
    wezterm_set_user_var first_login "$time"

    if test $silent -eq 0
        echo "$time"
    end
end

function workday_end
    set start (first_login_of_the_day)

    if test -z "$start" -o (string length "$start") -ne 8
        set start "08:15:00"
    end

    set today (date +'%Y-%m-%d')
    set start_ts (date -j -f "%Y-%m-%d %H:%M:%S" "$today $start" +"%s")

    set seconds_to_add 27000
    set end_ts (math "$start_ts + $seconds_to_add")

    date -r $end_ts +"%T"
end

function remaining_work_hours
    set -l first_login (first_login_of_the_day)

    if test -z "$first_login"
        echo "Error: No first login time"
        return 1
    end

    set -l current_time (date "+%H:%M")

    set -l work_end (workday_end)

    set -l current_hours (string split ":" "$current_time")[1]
    set -l current_minutes (string split ":" "$current_time")[2]
    set -l end_hours (string split ":" "$work_end")[1]
    set -l end_minutes (string split ":" "$work_end")[2]

    set -l remaining_hours (math $end_hours - $current_hours)
    set -l remaining_minutes (math $end_minutes - $current_minutes)

    if test $remaining_minutes -lt 0
        set remaining_hours (math $remaining_hours - 1)
        set remaining_minutes (math $remaining_minutes + 60)
    end

    if test $remaining_hours -gt 0
        printf "%d hours and %d minutes left\n" $remaining_hours $remaining_minutes
    else if test $remaining_minutes -gt 0
        printf "%d minutes left\n" $remaining_minutes
    else
        echo "Work day is over"
        return
    end

    printf "Workday ends at: %s\n" $work_end
end

function set_workday_start
    set -l time_input (gum input \
            --placeholder "HH:MM" \
            --prompt "󱫒 Started workday at: ")

    # Exit if user presses Ctrl+C or enters nothing
    if test -z "$time_input"
        return 1
    end

    set -l current_date (date "+%y-%m-%d")
    set -l cache_file "/tmp/.first_login/$current_date"

    # Validate input: must match 24-hour HH:MM
    if string match -rq '^(0?[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' -- $time_input
        set -g TIME_HOUR (string split ":" $time_input)[1]
        set -g TIME_MINUTE (string split ":" $time_input)[2]

        set -l start_time "$time_input:00"
        mkdir -p (dirname "$cache_file")
        echo "$start_time" >"$cache_file"
        wezterm_set_user_var first_login "$start_time"
        echo (set_color green)" Workday started at $TIME_HOUR:$TIME_MINUTE"(set_color normal)
        return 0
    else
        gum style \
            --border rounded --border-foreground 1 --margin "0 1" \
            "   Invalid time format "
    end
end

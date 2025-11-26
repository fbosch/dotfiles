# Time tracking and workday functions

function parse_flexible_date --description "Parse flexible date input and return YYYY-MM-DD format"
    set -l input $argv[1]
    
    # No input - return today
    if test -z "$input"
        command date +%Y-%m-%d
        return 0
    end
    
    # Full date: DD.MM.YYYY
    if string match -qr '^\d{2}\.\d{2}\.\d{4}$' $input
        set -l parts (string split '.' $input)
        echo "$parts[3]-$parts[2]-$parts[1]"
        return 0
    end
    
    # Month and day only: DD.MM (assume current year)
    if string match -qr '^\d{2}\.\d{2}$' $input
        set -l parts (string split '.' $input)
        set -l current_year (command date +%Y)
        echo "$current_year-$parts[2]-$parts[1]"
        return 0
    end
    
    # ISO format: YYYY-MM-DD
    if string match -qr '^\d{4}-\d{2}-\d{2}$' $input
        echo $input
        return 0
    end
    
    # Weekday names (case-insensitive)
    if string match -qir '^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$' $input
        set -l weekday (string lower $input)
        set -l target_weekday_num
        
        switch $weekday
            case monday
                set target_weekday_num 1
            case tuesday
                set target_weekday_num 2
            case wednesday
                set target_weekday_num 3
            case thursday
                set target_weekday_num 4
            case friday
                set target_weekday_num 5
            case saturday
                set target_weekday_num 6
            case sunday
                set target_weekday_num 7
        end
        
        # Get current weekday (1=Monday, 7=Sunday)
        set -l current_weekday_num (command date +%u)
        
        # Calculate days to subtract
        set -l days_back (math "$current_weekday_num - $target_weekday_num")
        
        # If result is negative, go back a full week
        if test $days_back -lt 0
            set days_back (math "$days_back + 7")
        end
        
        # Get the date (cross-platform)
        if test (uname) = Darwin
            # macOS date command - use gdate (GNU date) if available, otherwise use date -v
            if command -v gdate >/dev/null 2>&1
                gdate -d "$days_back days ago" +%Y-%m-%d
            else
                # macOS native date with -v flag (no dash before number if 0)
                if test $days_back -eq 0
                    command date +%Y-%m-%d
                else
                    command date -v-"$days_back"d +%Y-%m-%d
                end
            end
        else
            # Linux date command
            command date -d "$days_back days ago" +%Y-%m-%d
        end
        return 0
    end
    
    # Invalid format
    return 1
end

function format_date_display --description "Convert YYYY-MM-DD to DD.MM.YYYY for display"
    set -l iso_date $argv[1]
    set -l parts (string split '-' $iso_date)
    echo "$parts[3].$parts[2].$parts[1]"
end

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

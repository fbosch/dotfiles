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

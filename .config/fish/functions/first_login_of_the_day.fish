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

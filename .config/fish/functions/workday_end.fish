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

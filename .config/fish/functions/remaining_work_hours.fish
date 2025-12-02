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

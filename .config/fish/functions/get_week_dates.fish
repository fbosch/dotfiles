function get_week_dates
    # Validate and set week number
    set -l week_number (date +%V)
    if set -q argv[1]
        and string match -r '^\d+$' -- "$argv[1]"
        and test "$argv[1]" -ge 1
        and test "$argv[1]" -le 53
        set week_number $argv[1]
    else if set -q argv[1]
        echo "Error: Week number must be between 1 and 53"
        return 1
    end

    # Validate and set year
    set -l year (date +%Y)
    if set -q argv[2]
        and string match -r '^\d{4}$' -- "$argv[2]"
        set year $argv[2]
    end

    # BSD date week calculation function
    function _calculate_week_dates
        set -l input_year $argv[1]
        set -l input_week $argv[2]

        # Calculate the first Monday of the year
        set -l jan1 (date -j -f "%Y-%m-%d" "$input_year-01-01" +%s)
        set -l jan1_weekday (date -j -f "%Y-%m-%d" "$input_year-01-01" +%w)

        # Adjust to get to the first Monday
        set -l days_to_first_monday (math "1 - $jan1_weekday")
        if test $days_to_first_monday -ge 0
            set days_to_first_monday (math "$days_to_first_monday - 7")
        end

        # Calculate the start of the specified week
        set -l week_start_seconds (math "$jan1 + ($input_week - 1) * 7 * 86400 + $days_to_first_monday * 86400")
        set -l week_end_seconds (math "$week_start_seconds + 6 * 86400")

        # Convert timestamps to dates
        set --local start_date (date -j -f "%s" "$week_start_seconds" +"%d %B")
        set --local end_date (date -j -f "%s" "$week_end_seconds" +"%d %B")

        echo $start_date
        echo $end_date
    end

    # Calculate and set dates
    set -l dates (_calculate_week_dates $year $week_number)
    set -l start_date $dates[1]
    set -l end_date $dates[2]

    # Print results
    echo "Week $week_number ($year):"
    echo "Start date: $start_date"
    echo "End date: $end_date"
end

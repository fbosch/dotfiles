function workitems_week --description 'Display calendar view of work items touched during the current, previous, or selected week'
    if test "$argv[1]" = previous
        set argv --previous $argv[2..-1]
    end
    argparse -n workitems_week p/previous r/refresh -- $argv
    or return

    set -l week_number
    if test (count $argv) -gt 1
        echo "workitems_week: expected at most one week number" >&2
        return 2
    end
    if test (count $argv) -eq 1
        if not string match -r '^[0-9]+$' -- "$argv[1]" >/dev/null
            echo "workitems_week: week number must be an integer from 1 to 53" >&2
            return 2
        end
        set week_number $argv[1]
        if test $week_number -lt 1
            echo "workitems_week: week number must be between 1 and 53" >&2
            return 2
        else if test $week_number -gt 53
            echo "workitems_week: week number must be between 1 and 53" >&2
            return 2
        end
        if set -q _flag_previous
            echo "workitems_week: cannot combine a week number with --previous" >&2
            return 2
        end
    end

    if not git rev-parse --git-dir >/dev/null 2>&1
        gum style " Not in a git repository"
        return 1
    end
    

    set -l is_darwin 0
    if test (uname) = Darwin
        set is_darwin 1
    end
    set -l has_gdate 0
    if command -v gdate >/dev/null 2>&1
        set has_gdate 1
    end

    set -l monday
    if test -n "$week_number"
        # Danish week numbers follow ISO 8601: week 1 contains January 4.
        set -l target_year (command date +%Y)
        set -l january_fourth "$target_year-01-04"
        set -l jan4_weekday
        if test $is_darwin -eq 1
            if test $has_gdate -eq 1
                set jan4_weekday (gdate -d "$january_fourth" +%u)
            else
                set jan4_weekday (command date -j -f "%Y-%m-%d" "$january_fourth" +%u)
            end
        else
            set jan4_weekday (command date -d "$january_fourth" +%u)
        end

        set -l days_to_week_one (math "$jan4_weekday - 1")
        set -l week_one_monday
        if test $days_to_week_one -eq 0
            set week_one_monday $january_fourth
        else if test $is_darwin -eq 1
            if test $has_gdate -eq 1
                set week_one_monday (gdate -d "$january_fourth -$days_to_week_one days" +%Y-%m-%d)
            else
                set week_one_monday (command date -j -v-"$days_to_week_one"d -f "%Y-%m-%d" "$january_fourth" +%Y-%m-%d)
            end
        else
            set week_one_monday (command date -d "$january_fourth -$days_to_week_one days" +%Y-%m-%d)
        end

        set -l week_offset_days (math "($week_number - 1) * 7")
        if test $week_offset_days -eq 0
            set monday $week_one_monday
        else if test $is_darwin -eq 1
            if test $has_gdate -eq 1
                set monday (gdate -d "$week_one_monday +$week_offset_days days" +%Y-%m-%d)
            else
                set monday (command date -j -v+"$week_offset_days"d -f "%Y-%m-%d" "$week_one_monday" +%Y-%m-%d)
            end
        else
            set monday (command date -d "$week_one_monday +$week_offset_days days" +%Y-%m-%d)
        end

        set -l calculated_week
        set -l calculated_iso_year
        if test $is_darwin -eq 1
            if test $has_gdate -eq 1
                set calculated_week (gdate -d "$monday" +%V)
                set calculated_iso_year (gdate -d "$monday" +%G)
            else
                set calculated_week (command date -j -f "%Y-%m-%d" "$monday" +%V)
                set calculated_iso_year (command date -j -f "%Y-%m-%d" "$monday" +%G)
            end
        else
            set calculated_week (command date -d "$monday" +%V)
            set calculated_iso_year (command date -d "$monday" +%G)
        end
        if test "$calculated_iso_year" != "$target_year"
            echo "workitems_week: week $week_number does not exist in $target_year" >&2
            return 2
        end
        if test (math "$calculated_week") -ne $week_number
            echo "workitems_week: week $week_number does not exist in $target_year" >&2
            return 2
        end
    else
        # Get the current week's date range (Monday to Sunday)
        set -l current_weekday (command date +%u)
        set -l days_since_monday (math "$current_weekday - 1")
        if set -q _flag_previous
            set days_since_monday (math "$days_since_monday + 7")
        end

        # Calculate Monday of current week
        if test $is_darwin -eq 1
            if test $has_gdate -eq 1
                set monday (gdate -d "$days_since_monday days ago" +%Y-%m-%d)
            else
                if test $days_since_monday -eq 0
                    set monday (command date +%Y-%m-%d)
                else
                    set monday (command date -v-"$days_since_monday"d +%Y-%m-%d)
                end
            end
        else
            set monday (command date -d "$days_since_monday days ago" +%Y-%m-%d)
        end
    end
    
    # Build arrays for each day of the week
    set -l weekdays Monday Tuesday Wednesday Thursday Friday
    set -l dates
    set -l workitems_by_day
    
    # Generate dates for the week (Monday-Friday only)
    for i in (seq 0 4)
        if test $is_darwin -eq 1
            if test $has_gdate -eq 1
                set -a dates (gdate -d "$monday +$i days" +%Y-%m-%d)
            else
                if test $i -eq 0
                    set -a dates $monday
                else
                    set -a dates (command date -j -v+"$i"d -f "%Y-%m-%d" "$monday" +%Y-%m-%d)
                end
            end
        else
            set -a dates (command date -d "$monday +$i days" +%Y-%m-%d)
        end
    end
    
    # Get today's date for highlighting
    set -l today (command date +%Y-%m-%d)

    set -l use_refresh 0
    if set -q _flag_refresh
        set use_refresh 1
    end
    
    set -l extracted_items
    set -l extract_mode authored_branches
    if set -q _flag_previous
        set -a extracted_items (__workitems_extract $dates[1] $dates[5] $extract_mode $use_refresh)
    else
        # Cache past weekdays individually, then only compute the remaining span once.
        set -l remaining_start_idx 0

        for day_idx in (seq 1 5)
            set -l target_date $dates[$day_idx]

            if test "$target_date" = "$today"
                set remaining_start_idx $day_idx
                break
            end

            set -l sorted_dates (printf "%s\n%s\n" "$target_date" "$today" | sort)
            if test "$sorted_dates[1]" = "$target_date"
                set -a extracted_items (__workitems_extract $target_date $target_date $extract_mode $use_refresh)
            else
                set remaining_start_idx $day_idx
                break
            end
        end

        if test $remaining_start_idx -gt 0
            set -a extracted_items (__workitems_extract $dates[$remaining_start_idx] $dates[5] $extract_mode $use_refresh)
        end
    end

    for day_idx in (seq 1 5)
        set -l target_date $dates[$day_idx]
        set -l day_workitems

        for item in $extracted_items
            set -l parts (string split '|' $item)
            if test "$parts[1]" = "$target_date"
                set -l workitem $parts[2]
                if not contains $workitem $day_workitems
                    set -a day_workitems $workitem
                end
            end
        end

        if test (count $day_workitems) -gt 0
            set -a workitems_by_day (string join ', ' $day_workitems)
        else
            set -a workitems_by_day "-"
        end
    end
    
    # Display the table header
    echo ""
    set -l title_prefix "Work Items"
    if set -q _flag_previous
        set title_prefix "Work Items (Previous)"
    else if test -n "$week_number"
        set title_prefix "Work Items (Week $week_number)"
    end
    gum style --foreground 2 --bold "$title_prefix - Week of "(format_date_display $monday)
    echo ""
    
    # Print table header
    printf "%-15s │ %-12s │ %s\n" "Day" "Date" "Work Items"
    printf "────────────────┼──────────────┼────────────────────────────────────────\n"
    
    # Print each day
    for i in (seq 1 5)
        set -l day $weekdays[$i]
        set -l date_val $dates[$i]
        set -l date_display (format_date_display $date_val)
        set -l items $workitems_by_day[$i]
        
        # Highlight today in green
        if test "$date_val" = "$today"
            printf (set_color green)"→ %-13s │ %-12s │ %s"(set_color normal)"\n" $day $date_display $items
        else
            printf "%-15s │ %-12s │ %s\n" $day $date_display $items
        end
    end
    
    echo ""
end

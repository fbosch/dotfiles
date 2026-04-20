function workitems_week --description 'Display calendar view of work items touched during the current or previous week'
    argparse -n workitems_week p/previous -- $argv
    or return

    if not git rev-parse --git-dir >/dev/null 2>&1
        gum style " Not in a git repository"
        return 1
    end
    
    # Get the current week's date range (Monday to Sunday)
    set -l is_darwin 0
    if test (uname) = Darwin
        set is_darwin 1
    end
    set -l has_gdate 0
    if command -v gdate >/dev/null 2>&1
        set has_gdate 1
    end

    set -l current_weekday (command date +%u)
    set -l days_since_monday (math "$current_weekday - 1")
    if set -q _flag_previous
        set days_since_monday (math "$days_since_monday + 7")
    end
    
    # Calculate Monday of current week
    set -l monday
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
    
    set -l extracted_items
    if set -q _flag_previous
        set -a extracted_items (__workitems_extract $dates[1] $dates[5])
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
                set -a extracted_items (__workitems_extract $target_date $target_date)
            else
                set remaining_start_idx $day_idx
                break
            end
        end

        if test $remaining_start_idx -gt 0
            set -a extracted_items (__workitems_extract $dates[$remaining_start_idx] $dates[5])
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

function workitems_week --description 'Display calendar view of work items touched during the current week'
    if not git rev-parse --git-dir >/dev/null 2>&1
        gum style " Not in a git repository"
        return 1
    end
    
    # Get the current week's date range (Monday to Sunday)
    set -l current_weekday (command date +%u)
    set -l days_since_monday (math "$current_weekday - 1")
    
    # Calculate Monday of current week
    set -l monday
    if test (uname) = Darwin
        if command -v gdate >/dev/null 2>&1
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
        if test (uname) = Darwin
            if command -v gdate >/dev/null 2>&1
                set -a dates (gdate -d "$monday +$i days" +%Y-%m-%d)
            else
                if test $i -eq 0
                    set -a dates $monday
                else
                    # Parse monday date and add days
                    set -l year (string split '-' $monday)[1]
                    set -l month (string split '-' $monday)[2]
                    set -l day (string split '-' $monday)[3]
                    set -a dates (command date -j -v+"$i"d -f "%Y-%m-%d" "$year-$month-$day" +%Y-%m-%d)
                end
            end
        else
            set -a dates (command date -d "$monday +$i days" +%Y-%m-%d)
        end
    end
    
    # Get today's date for highlighting
    set -l today (command date +%Y-%m-%d)
    
    # Extract work items for each day (uses cache when available)
    for day_idx in (seq 1 5)
        set -l target_date $dates[$day_idx]
        set -l day_workitems
        
        # Extract work items for this single day (automatically cached if past date)
        set -l extracted_items (__workitems_extract $target_date $target_date)
        
        # Collect unique work items for this day
        for item in $extracted_items
            set -l parts (string split '|' $item)
            set -l workitem $parts[2]
            
            # Add unique work items
            if not contains $workitem $day_workitems
                set -a day_workitems $workitem
            end
        end
        
        # Store the work items for this day (comma-separated or empty)
        if test (count $day_workitems) -gt 0
            set -a workitems_by_day (string join ', ' $day_workitems)
        else
            set -a workitems_by_day "-"
        end
    end
    
    # Display the table header
    echo ""
    gum style --foreground 2 --bold "Work Items - Week of "(format_date_display $monday)
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

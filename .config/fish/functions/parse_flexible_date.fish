function parse_flexible_date --description 'Parse flexible date input and return YYYY-MM-DD format'
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

function __time_ago_from_timestamp --description 'Convert ISO 8601 timestamp to human-readable "time ago" format'
    # Usage: __time_ago_from_timestamp "2025-01-15T10:30:00Z"
    # Returns: "2 days and 3 hours ago" or empty string on error
    
    set timestamp $argv[1]
    if test -z "$timestamp"
        return 1
    end
    
    # Calculate time difference in seconds
    set then_epoch (date -d "$timestamp" +%s 2>/dev/null)
    or return 1
    
    set now_epoch (date +%s)
    set diff_seconds (math $now_epoch - $then_epoch)
    
    # Handle negative differences (future timestamps)
    if test $diff_seconds -lt 0
        return 1
    end
    
    # Convert to time units
    set days (math "floor($diff_seconds / 86400)")
    set hours (math "floor(($diff_seconds % 86400) / 3600)")
    set minutes (math "floor(($diff_seconds % 3600) / 60)")
    
    # Build human-readable output
    if test $days -gt 0
        if test $hours -gt 0
            printf "%d day%s and %d hour%s ago\n" \
                $days (test $days -eq 1; and echo "" || echo "s") \
                $hours (test $hours -eq 1; and echo "" || echo "s")
        else
            printf "%d day%s ago\n" $days (test $days -eq 1; and echo "" || echo "s")
        end
    else if test $hours -gt 0
        if test $minutes -gt 0
            printf "%d hour%s and %d minute%s ago\n" \
                $hours (test $hours -eq 1; and echo "" || echo "s") \
                $minutes (test $minutes -eq 1; and echo "" || echo "s")
        else
            printf "%d hour%s ago\n" $hours (test $hours -eq 1; and echo "" || echo "s")
        end
    else if test $minutes -gt 0
        printf "%d minute%s ago\n" $minutes (test $minutes -eq 1; and echo "" || echo "s")
    else
        echo "just now"
    end
end

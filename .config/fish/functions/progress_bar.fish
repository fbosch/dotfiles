function progress_bar --description 'Display a live-updating progress bar with current item and stats'
    argparse 'c/current=' 't/total=' 'w/width=' 'l/label=' 'i/init' 'f/finish' 'n/name=' 's/stats=' 'm/max-name-len=' -- $argv
    or return 1

    # Initialize: hide cursor and calculate fixed width
    if set -q _flag_init
        tput civis 2>/dev/null >&2  # Hide cursor
        set -g __progress_bar_exists false
        
        # Detect if we can use Nerd Fonts (check if TERM supports unicode and we're not in a basic tty)
        set -g __progress_use_nerd_fonts true
        if test "$TERM" = "linux"; or test "$TERM" = "dumb"
            set -g __progress_use_nerd_fonts false
        else if not string match -q "*UTF*" "$LANG$LC_ALL"
            set -g __progress_use_nerd_fonts false
        end
        
        # Calculate and store fixed bar width based on terminal
        set -l term_width (tput cols 2>/dev/null; or echo 80)
        
        # Get max name length (default 40)
        set -l max_name_len (set -q _flag_max_name_len; and echo $_flag_max_name_len; or echo 40)
        
        # Calculate fixed reserved space for worst case
        # Format: "Label: [max_name...] (99✓ 99⊘) [bar] 100% (999/999)"
        # Label (8) + ": " (2) + max_name (40) + " (" (2) + stats (9) + ") " (2) + "[" (1) + "]" (1) + " " (1) + "100%" (4) + " " (1) + "(999/999)" (9) = 80
        set -l label (set -q _flag_label; and echo "$_flag_label"; or echo "Progress")
        set -l reserved (math (string length "$label") + 2 + $max_name_len + 2 + 9 + 2 + 2 + 1 + 4 + 1 + 9)
        
        # Bar width is remaining space (minimum 20, maximum 60)
        set -g __progress_bar_width (math "max(20, min(60, $term_width - $reserved))")
        set -g __progress_max_name_len $max_name_len
        
        return 0
    end

    # Finish: show cursor and print newline
    if set -q _flag_finish
        tput cnorm 2>/dev/null >&2  # Show cursor
        echo >&2
        set -e __progress_bar_exists
        set -e __progress_bar_width
        set -e __progress_max_name_len
        set -e __progress_use_nerd_fonts
        return 0
    end

    # Validate required arguments for update
    if not set -q _flag_current; or not set -q _flag_total
        echo "Usage: progress_bar --init [--max-name-len N]" >&2
        echo "       progress_bar --current N --total N [--label TEXT] [--name ITEM] [--stats STATS]" >&2
        echo "       progress_bar --finish" >&2
        return 1
    end

    set -l current $_flag_current
    set -l total $_flag_total
    set -l label (set -q _flag_label; and echo "$_flag_label"; or echo "Progress")
    set -l item_name (set -q _flag_name; and echo "$_flag_name"; or echo "")
    set -l stats (set -q _flag_stats; and echo "$_flag_stats"; or echo "")

    # Truncate item name if too long
    if test -n "$item_name"
        set -l name_len (string length "$item_name")
        if test $name_len -gt $__progress_max_name_len
            set item_name (string sub -l (math $__progress_max_name_len - 3) "$item_name")"..."
        end
    end

    # Use the fixed width calculated at init
    set -l width $__progress_bar_width

    # Calculate progress
    set -l percentage (math "floor(100 * $current / $total)")
    set -l filled (math "floor($width * $current / $total)")
    set -l empty (math "$width - $filled")
    
    # Build progress bar with color and appropriate symbols based on environment
    set -l bar_filled
    set -l bar_empty
    if test "$__progress_use_nerd_fonts" = "true"
        # Using █ (full block U+2588) for filled, ░ (light shade U+2591) for empty
        set bar_filled (set_color green 2>/dev/null)(string repeat -n $filled "█")(set_color normal 2>/dev/null)
        set bar_empty (set_color 240 2>/dev/null)(string repeat -n $empty "░")(set_color normal 2>/dev/null)
    else
        # ASCII fallback: = for filled, - for empty
        set bar_filled (string repeat -n $filled "=")
        set bar_empty (string repeat -n $empty "-")
    end
    set -l bar "[$bar_filled$bar_empty]"
    
    # Build the complete progress line with fixed-width name field
    set -l label_part "$label"
    if test -n "$item_name"
        # Pad name to max length for consistent width
        set -l padded_name (printf "%-*s" $__progress_max_name_len "$item_name")
        set label_part "$label_part: $padded_name"
    end
    if test -n "$stats"
        set label_part "$label_part ($stats)"
    end
    
    set -l percentage_str (printf '%3d%%' $percentage)
    set -l counter_str (printf '(%d/%d)' $current $total)
    set -l progress_line "$label_part $bar $percentage_str $counter_str"
    
    # If progress bar exists on current line, update in place
    # Otherwise, we're on a new line (after output), so just print it
    if test "$__progress_bar_exists" = "true"
        # Update in place with carriage return
        printf '\r' >&2
        tput el 2>/dev/null >&2
        printf '%s' $progress_line >&2
    else
        # First render, just print it
        printf '%s' $progress_line >&2
        set -g __progress_bar_exists true
    end
end

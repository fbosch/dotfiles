function __rate_limit_bar_segments --description "Render raw rate-limit bar segments"
    argparse 'remaining=' 'width=' 'filled=' 'empty=' 'minimum-one' -- $argv
    or return 2

    for flag in remaining width filled empty
        if not set -q _flag_$flag
            echo "__rate_limit_bar_segments: --$flag is required" >&2
            return 2
        end
    end

    if not string match -rq '^[0-9]+$' -- "$_flag_remaining"
        echo "__rate_limit_bar_segments: --remaining must be an integer from 0 to 100" >&2
        return 2
    end

    if test "$_flag_remaining" -gt 100
        echo "__rate_limit_bar_segments: --remaining must be an integer from 0 to 100" >&2
        return 2
    end

    if not string match -rq '^[1-9][0-9]*$' -- "$_flag_width"
        echo "__rate_limit_bar_segments: --width must be a positive integer" >&2
        return 2
    end

    if test -z "$_flag_filled"; or test -z "$_flag_empty"
        echo "__rate_limit_bar_segments: --filled and --empty must be non-empty" >&2
        return 2
    end

    set -l filled_cells (math "floor($_flag_remaining * $_flag_width / 100)")
    if set -q _flag_minimum_one; and test "$_flag_remaining" -gt 0; and test "$filled_cells" -eq 0
        set filled_cells 1
    end
    set -l empty_cells (math "$_flag_width - $filled_cells")
    set -l capacity_band critical
    if test "$_flag_remaining" -ge 75
        set capacity_band high
    else if test "$_flag_remaining" -ge 50
        set capacity_band medium
    else if test "$_flag_remaining" -ge 25
        set capacity_band low
    end

    set -l filled_segment (string repeat -n "$filled_cells" -- "$_flag_filled")
    set -l empty_segment (string repeat -n "$empty_cells" -- "$_flag_empty")
    printf '%s\t%s\t%s\n' "$filled_segment" "$empty_segment" "$capacity_band"
end

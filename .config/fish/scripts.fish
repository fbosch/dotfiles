function copy_output --description "Copy output of previous command to clipboard"
    set -l last_cmd $history[1]
    set -l last_output (eval $last_cmd 2>&1)
    if test -n "$last_output"
        # Cross-platform clipboard copy
        set clipboard_cmd pbcopy
        if test (uname) != Darwin
            if command -v wl-copy >/dev/null 2>&1
                set clipboard_cmd wl-copy
            else if command -v xclip >/dev/null 2>&1
                set clipboard_cmd "xclip -selection clipboard"
            else
                gum style --foreground 1 "✗ No clipboard command found"
                return 1
            end
        end
        echo $last_output | eval $clipboard_cmd
        gum style --foreground 2 "✓ Copied output of: $last_cmd"
    else
        gum style --foreground 3 "⚠ No output to copy"
    end
end

function co --description "Alias for copy_output"
    copy_output
end

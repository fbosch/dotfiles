function copy_output --description "Copy output of previous command to clipboard"
    set -l last_cmd $history[1]
    set -l last_output (eval $last_cmd 2>&1)
    if test -n "$last_output"
        echo $last_output | pbcopy
        gum style --foreground 2 "✓ Copied output of: $last_cmd"
    else
        gum style --foreground 3 "⚠ No output to copy"
    end
end

function co --description "Alias for copy_output"
    copy_output
end
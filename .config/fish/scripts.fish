function copy_output --description "Copy output of previous command to clipboard"
    set -l last_output (eval $history[1] 2>&1)
    if test -n "$last_output"
        echo $last_output | pbcopy
        echo "Copied output of: $history[1]"
    else
        echo "No output to copy"
    end
end

function co --description "Alias for copy_output"
    copy_output
end
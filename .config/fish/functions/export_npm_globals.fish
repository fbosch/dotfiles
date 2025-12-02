function export_npm_globals
    set old_file ~/dotfiles/npm-globals.json.bak
    set new_file ~/dotfiles/npm-globals.json

    if test -f $new_file
        mv $new_file $old_file
    end

    # Exclude 'npm' itself from export
    npm list -g --depth=0 --json | jq 'del(.dependencies.npm) | .dependencies | map_values(.version)' >$new_file

    if test -f $old_file
        echo "Diff (old vs new):"
        difft $old_file $new_file
    else
        echo "No previous npm-globals.json found, exported current global packages."
        cat $new_file
    end
end

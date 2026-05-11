function fzfcd
    set -l selected_dir
    set -l is_bare_repo (git rev-parse --is-bare-repository 2>/dev/null)
    if test "$is_bare_repo" = true
        # In a bare repository, pick from child worktree directories containing a .git file.
        set selected_dir (fd -tf --max-depth=4 --color=never '.git$' -H -E .git -E .wt | rev | cut -c 6- | rev | fzf --preview "lt {}" --preview-window "25%" < /dev/tty)
    else
        set selected_dir (fd -td --max-depth=4 --color=never --hidden -E .git -E .wt -E node_modules -E .direnv -E .cache | fzf --preview "lt {}" --preview-window "25%" < /dev/tty)
    end

    set -l picker_status $status
    if test $picker_status -ne 0
        return $picker_status
    end

    if test -n "$selected_dir"
        cd "$selected_dir"
        commandline --function repaint
    end
end

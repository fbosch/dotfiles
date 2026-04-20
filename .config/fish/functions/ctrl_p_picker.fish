function ctrl_p_picker --description 'Use git worktree picker when available'
    set -l picker_status 0

    if not git rev-parse --git-dir >/dev/null 2>&1
        fzfcd
        set picker_status $status
        if status --is-interactive
            commandline --function repaint repaint-mode
        end
        return $picker_status
    end

    set -l worktree_count (git worktree list --porcelain 2>/dev/null | string match -r '^worktree ' | count)
    if test $worktree_count -gt 1
        wtfzf
        set picker_status $status
    else
        fzfcd
        set picker_status $status
    end

    if status --is-interactive
        commandline --function repaint repaint-mode
    end

    return $picker_status
end

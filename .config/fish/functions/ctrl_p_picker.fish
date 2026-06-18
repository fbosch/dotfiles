function ctrl_p_picker --description 'Use git worktree picker when available'
    set -l picker fzfcd

    if git rev-parse --git-dir >/dev/null 2>&1
        set -l worktree_count (git worktree list --porcelain 2>/dev/null | string match -r '^worktree ' | count)
        if test $worktree_count -gt 1
            set picker wtfzf
        end
    end

    $picker
    set -l picker_status $status

    if status --is-interactive
        commandline --function repaint repaint-mode
    end

    return $picker_status
end

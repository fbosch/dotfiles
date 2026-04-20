function ctrl_p_picker --description 'Use git worktree picker when available'
    if not git rev-parse --git-dir >/dev/null 2>&1
        fzfcd
        return $status
    end

    set -l worktree_count (git worktree list --porcelain 2>/dev/null | string match -r '^worktree ' | count)
    if test $worktree_count -gt 1
        wtfzf
        return $status
    end

    fzfcd
end

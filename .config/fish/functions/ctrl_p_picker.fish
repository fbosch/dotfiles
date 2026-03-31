function ctrl_p_picker --description 'Use Worktrunk picker for linked worktrees'
    if not command -v wt >/dev/null 2>&1
        fzfcd
        return $status
    end

    if not git rev-parse --git-dir >/dev/null 2>&1
        fzfcd
        return $status
    end

    set -l git_dir (git rev-parse --git-dir 2>/dev/null)
    if string match -q '*worktrees/*' -- "$git_dir"
        wt list --format=json >/dev/null 2>&1
        if test $status -eq 0
            wtfzf
            return $status
        end
    end

    fzfcd
end

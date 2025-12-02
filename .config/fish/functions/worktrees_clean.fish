function worktrees_clean --description 'Remove stale git worktrees (>7d) and their local branches'
    set -l worktrees (fd -t d --min-depth 2 --max-depth 2 --changed-before 7d)
    set -l total (count $worktrees)
    if test $total -eq 0
        echo "No old worktrees found (>7d)."
        return 0
    end
    set -l i 0
    set -l protected_branches main master develop release
    for wt in $worktrees
        if not test -f "$wt/.git"
            continue
        end
        if not string match -rq '^gitdir:' (head -n1 "$wt/.git")
            continue
        end
        set -l branch (git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null)
        set i (math $i + 1)
        set -l pct (math "100.0 * $i / $total")
        printf "Removing old worktrees: %.2f%%\r" $pct
        git worktree remove "$wt" 2>/dev/null
        or begin
            continue
        end
        if test "$branch" != "" -a "$branch" != HEAD
            if git show-ref --verify --quiet "refs/heads/$branch"
                if not contains -- $branch $protected_branches
                    git branch -D "$branch" 2>/dev/null
                end
            end
        end
        if test -d "$wt"
            rm -rf "$wt"
        end
    end
    printf "\n"
    git worktree prune
end

function worktree_add
    if not test -d .bare
        echo (set_color yellow)"Warning: Cannot create worktree outside a bare Git repository root. Aborting! ⚠️"(set_color normal)
        return 1
    end
    set branch_name $argv[1]

    if test -d main
        echo (set_color cyan)"Pulling latest changes in main..."(set_color normal)
        git -C main pull --rebase
    end

    set remote_branch_exists (git ls-remote --exit-code --heads origin $branch_name; echo $status)

    if test $remote_branch_exists -eq 0
        git worktree add $branch_name $branch_name
    else
        git worktree add -b $branch_name $branch_name
    end

    cd $branch_name
    swpm install --prefer-offline
    git reset --hard HEAD
    echo (pwd) >>/tmp/.recent-worktrees
    echo (set_color green)"Worktree created and dependencies installed ✅"(set_color normal)
end

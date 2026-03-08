function git_pull_system_repos --description 'Pull ~/nixos and ~/dotfiles with ff-only and safety checks'
    set -l repos ~/nixos ~/dotfiles
    set -l had_failure 0

    for repo in $repos
        if not test -d $repo
            echo "==> Skipping $repo (directory not found)"
            set had_failure 1
            continue
        end

        if not git -C $repo rev-parse --is-inside-work-tree >/dev/null 2>&1
            echo "==> Skipping $repo (not a git repo)"
            set had_failure 1
            continue
        end

        set -l repo_status (git -C $repo status --porcelain)
        if test -n "$repo_status"
            echo "==> Skipping $repo (dirty working tree)"
            set had_failure 1
            continue
        end

        echo "==> Pulling $repo"
        git -C $repo pull --ff-only
        if test $status -eq 0
            echo "==> Done $repo"
        else
            echo "==> Failed $repo"
            set had_failure 1
        end
    end

    return $had_failure
end

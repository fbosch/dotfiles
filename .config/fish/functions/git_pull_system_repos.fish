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
        else if test $repo = "$HOME/dotfiles"
            if test $had_failure -ne 0
                echo "==> Skipping dotfiles recovery because another repository failed"
                continue
            end

            set -l upstream (git -C $repo rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null)
            if test -z "$upstream"; or git -C $repo merge-base HEAD $upstream >/dev/null 2>&1
                echo "==> Failed $repo"
                set had_failure 1
                continue
            end

            set -l origin (git -C $repo remote get-url origin 2>/dev/null)
            if test -z "$origin"
                echo "==> Failed $repo (origin is not configured)"
                set had_failure 1
                continue
            end

            set -l timestamp (date +%Y%m%d-%H%M%S)
            set -l replacement "$repo.recovery-$timestamp"

            read -l -P "==> $repo has unrelated history. Replace the clean checkout with $origin? [y/N] " confirmation
            if not string match -qr '^y(es)?$' -- "$confirmation"
                echo "==> Recovery skipped for $repo"
                set had_failure 1
                continue
            end

            echo "==> Cloning replacement for $repo"
            if not git clone "$origin" "$replacement"
                echo "==> Failed to clone replacement for $repo"
                set had_failure 1
                continue
            end

            rm -rf "$repo"
            and mv "$replacement" "$repo"
            if test $status -eq 0
                echo "==> Recovered $repo"
            else
                echo "==> Failed to replace $repo; replacement remains at $replacement"
                set had_failure 1
            end
        else
            echo "==> Failed $repo"
            set had_failure 1
        end
    end

    if test $had_failure -eq 0
        echo '==> Restowing ~/dotfiles'
        stow -R -d ~/dotfiles -t ~ .
        if test $status -ne 0
            echo '==> Failed to restow ~/dotfiles'
            set had_failure 1
        else
            echo '==> Linking local Herdr plugins'
            herdr_link_plugins
            if test $status -ne 0
                echo '==> Failed to link local Herdr plugins'
                set had_failure 1
            end
        end
    end

    return $had_failure
end

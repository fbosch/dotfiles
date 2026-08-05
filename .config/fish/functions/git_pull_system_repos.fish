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

        if test $repo = "$HOME/dotfiles"
            if not command -q gh; or not gh auth status --hostname github.com >/dev/null 2>&1
                echo "==> Skipping $repo (authenticate with gh to align it with origin/master)"
                set had_failure 1
                continue
            end

            echo "==> Aligning $repo with origin/master"
            git -C $repo remote set-url origin git@github.com:fbosch/dotfiles
            if not git -C $repo fetch origin master
                echo "==> Failed to fetch origin/master for $repo"
                set had_failure 1
                continue
            end

            if not git -C $repo switch -C master origin/master
                echo "==> Failed to align $repo with origin/master"
                set had_failure 1
                continue
            end

            git -C $repo branch --set-upstream-to=origin/master master
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

    if test $had_failure -eq 0
        echo '==> Restowing ~/dotfiles'
        stow -R -d ~/dotfiles -t ~ .
        if test $status -ne 0
            echo '==> Failed to restow ~/dotfiles'
            set had_failure 1
        else
            if set -q CORPORATE
                echo '==> Installing shared FBB dependencies'
                just --justfile ~/dotfiles/justfile --working-directory ~/dotfiles install-fbb
            else
                echo '==> Installing OpenCode dependencies'
                just --justfile ~/dotfiles/justfile --working-directory ~/dotfiles install-fbb install-opencode-plugins
            end
            if test $status -ne 0
                echo '==> Failed to install dependencies'
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
    end

    return $had_failure
end

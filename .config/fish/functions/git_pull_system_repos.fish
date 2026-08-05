function git_pull_system_repos --description 'Pull system repositories, then restow dotfiles and install dependencies'
    set -l assume_yes 0

    for argument in $argv
        switch $argument
            case -y --yes
                set assume_yes 1
            case -h --help
                printf '%s\n' \
                    'Usage: git_pull_system_repos [--yes]' \
                    '' \
                    'Pull ~/nixos and ~/dotfiles with fast-forward-only updates.' \
                    'If ~/dotfiles is not on master, confirm before replacing local master with origin/master.' \
                    '' \
                    'After both repositories update successfully, this command:' \
                    '  - Restows ~/dotfiles' \
                    '  - Installs the applicable dependencies' \
                    '  - Links local Herdr plugins' \
                    '' \
                    'Options:' \
                    '  -y, --yes  Confirm dotfiles alignment without prompting.' \
                    '  -h, --help Show this help message.'
                return 0
            case '*'
                printf 'git_pull_system_repos: unknown option: %s\n' "$argument" >&2
                printf 'Run `git_pull_system_repos --help` for usage.\n' >&2
                return 2
        end
    end

    set -l dotfiles "$HOME/dotfiles"
    set -l repos "$HOME/nixos" "$dotfiles"
    set -l had_failure 0
    set -l align_dotfiles 0
    set -l dotfiles_branch

    printf 'Working  Checking repositories...\n' >&2
    for repo in $repos
        set -l label (string replace -- "$HOME" '~' "$repo")

        if not test -d "$repo"
            printf 'Warning  Skipped %s because the directory does not exist.\n' "$label" >&2
            printf '  Create %s, then rerun `git_pull_system_repos`.\n' "$label" >&2
            set had_failure 1
            continue
        end

        git -C "$repo" rev-parse --is-inside-work-tree >/dev/null 2>&1
        set -l status_code $status
        if contains -- $status_code 130 143
            return $status_code
        end
        if test $status_code -ne 0
            printf 'Warning  Skipped %s because it is not a Git repository.\n' "$label" >&2
            printf '  Initialize or restore the repository, then rerun `git_pull_system_repos`.\n' >&2
            set had_failure 1
            continue
        end

        set -l repo_status (git -C "$repo" status --porcelain)
        set status_code $status
        if contains -- $status_code 130 143
            return $status_code
        end
        if test $status_code -ne 0
            printf 'Error    Failed to inspect %s.\n' "$label" >&2
            printf '  Run `git -C %s status` before rerunning `git_pull_system_repos`.\n' "$label" >&2
            set had_failure 1
            continue
        end
        if test -n "$repo_status"
            printf 'Warning  Skipped %s because its working tree is dirty.\n' "$label" >&2
            printf '  Commit, stash, or discard changes, then rerun `git_pull_system_repos`.\n' >&2
            set had_failure 1
            continue
        end

        if test "$repo" = "$dotfiles"
            set dotfiles_branch (git -C "$repo" branch --show-current)
            set status_code $status
            if contains -- $status_code 130 143
                return $status_code
            end
            if test $status_code -ne 0
                printf 'Error    Failed to determine the current dotfiles branch.\n' >&2
                printf '  Run `git -C ~/dotfiles status` before rerunning `git_pull_system_repos`.\n' >&2
                set had_failure 1
                continue
            end
            if test "$dotfiles_branch" != master
                set align_dotfiles 1
            end
        end
    end

    if test $had_failure -ne 0
        printf 'Warning  Repository updates and post-pull setup were skipped because preflight checks failed.\n' >&2
        return 1
    end

    if test $align_dotfiles -eq 1
        set -l current_branch "$dotfiles_branch"
        if test -z "$current_branch"
            set current_branch 'detached HEAD'
        end

        if test $assume_yes -ne 1
            if not test -t 0
                printf 'git_pull_system_repos: ~/dotfiles is not on master; rerun with --yes to align it non-interactively.\n' >&2
                return 2
            end

            printf 'Align ~/dotfiles to origin/master\n' >&2
            printf '  Current branch  %s\n' "$current_branch" >&2
            printf '  Local master will be replaced with origin/master.\n\n' >&2
            printf 'Continue? [y/N] ' >&2
            read -l confirmation
            if not contains -- (string lower -- "$confirmation") y yes
                return 0
            end
        end
    end

    for repo in $repos
        set -l label (string replace -- "$HOME" '~' "$repo")

        if test "$repo" = "$dotfiles"; and test $align_dotfiles -eq 1
            printf 'Working  Aligning %s with origin/master...\n' "$label" >&2
            git -C "$repo" remote set-url origin git@github.com:fbosch/dotfiles
            set -l command_status $status
            if contains -- $command_status 130 143
                return $command_status
            end
            if test $command_status -ne 0
                printf 'Error    Failed to set the origin remote for %s.\n' "$label" >&2
                printf '  Run `git -C %s remote -v` before rerunning `git_pull_system_repos`.\n' "$label" >&2
                set had_failure 1
                continue
            end

            git -C "$repo" fetch origin master
            set command_status $status
            if contains -- $command_status 130 143
                return $command_status
            end
            if test $command_status -ne 0
                printf 'Error    Failed to fetch origin/master for %s.\n' "$label" >&2
                printf '  Restore GitHub SSH access, then run `git -C %s fetch origin master`.\n' "$label" >&2
                set had_failure 1
                continue
            end

            git -C "$repo" switch -C master origin/master
            set command_status $status
            if contains -- $command_status 130 143
                return $command_status
            end
            if test $command_status -ne 0
                printf 'Error    Failed to align %s with origin/master.\n' "$label" >&2
                printf '  Run `git -C %s status` before rerunning `git_pull_system_repos`.\n' "$label" >&2
                set had_failure 1
                continue
            end

            git -C "$repo" branch --set-upstream-to=origin/master master
            set command_status $status
            if contains -- $command_status 130 143
                return $command_status
            end
            if test $command_status -ne 0
                printf 'Error    Failed to set the upstream branch for %s.\n' "$label" >&2
                printf '  Run `git -C %s branch --set-upstream-to=origin/master master`.\n' "$label" >&2
                set had_failure 1
                continue
            end
        end

        printf 'Working  Pulling %s...\n' "$label" >&2
        git -C "$repo" pull --ff-only
        set -l command_status $status
        if contains -- $command_status 130 143
            return $command_status
        end
        if test $command_status -ne 0
            printf 'Error    Failed to pull %s.\n' "$label" >&2
            printf '  Run `git -C %s status` before rerunning `git_pull_system_repos`.\n' "$label" >&2
            set had_failure 1
            continue
        end
        printf 'Success  Pulled %s.\n' "$label" >&2
    end

    if test $had_failure -ne 0
        printf 'Warning  Post-pull setup was skipped because one or more repository updates failed.\n' >&2
        return 1
    end

    printf 'Working  Restowing ~/dotfiles...\n' >&2
    stow -R -d ~/dotfiles -t ~ .
    set -l command_status $status
    if contains -- $command_status 130 143
        return $command_status
    end
    if test $command_status -ne 0
        printf 'Error    Failed to restow ~/dotfiles.\n' >&2
        printf '  Run `stow -n -R -d ~/dotfiles -t ~ .` to inspect conflicts.\n' >&2
        return 1
    end

    if set -q CORPORATE
        printf 'Working  Installing shared FBB dependencies...\n' >&2
        just --justfile ~/dotfiles/justfile --working-directory ~/dotfiles install-fbb
    else
        printf 'Working  Installing OpenCode dependencies...\n' >&2
        just --justfile ~/dotfiles/justfile --working-directory ~/dotfiles install-fbb install-opencode-plugins
    end
    set command_status $status
    if contains -- $command_status 130 143
        return $command_status
    end
    if test $command_status -ne 0
        printf 'Error    Failed to install dependencies.\n' >&2
        if set -q CORPORATE
            printf '  Run `just --justfile ~/dotfiles/justfile --working-directory ~/dotfiles install-fbb` to diagnose the failure.\n' >&2
        else
            printf '  Run `just --justfile ~/dotfiles/justfile --working-directory ~/dotfiles install-fbb install-opencode-plugins` to diagnose the failure.\n' >&2
        end
        return 1
    end

    printf 'Working  Linking local Herdr plugins...\n' >&2
    herdr_link_plugins
    set command_status $status
    if contains -- $command_status 130 143
        return $command_status
    end
    if test $command_status -ne 0
        printf 'Error    Failed to link local Herdr plugins.\n' >&2
        printf '  Run `herdr_link_plugins` to diagnose the failure.\n' >&2
        return 1
    end

    printf 'Success  Updated system repositories and post-pull setup.\n' >&2
end

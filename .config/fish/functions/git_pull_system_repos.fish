function _git_pull_system_repos_confirm_alignment --description 'Confirm alignment of the deployed dotfiles checkout'
    set -l current_branch $argv[1]

    if not test -t 0
        printf 'git_pull_system_repos: ~/dotfiles is not on master; rerun with --yes to align it non-interactively.\n' >&2
        return 2
    end

    printf 'Align ~/dotfiles to origin/master\n' >&2
    printf '  Current branch  %s\n' "$current_branch" >&2
    printf '  Local master will be replaced with origin/master.\n\n' >&2
    printf 'Continue? [y/N] ' >&2
    read -l confirmation
    if contains -- (string lower -- "$confirmation") y yes
        return 0
    end

    return 1
end

function git_pull_system_repos --description 'Synchronize canonical system repositories, then restow dotfiles and install dependencies'
    set -l assume_yes 0

    for argument in $argv
        switch $argument
            case -y --yes
                set assume_yes 1
            case -h --help
                printf '%s\n' \
                    'Usage: git_pull_system_repos [--yes]' \
                    '' \
                    'Pull ~/nixos and the canonical deployed ~/dotfiles checkout with fast-forward-only updates.' \
                    'If ~/dotfiles is not on master, confirm before replacing local master with origin/master.' \
                    'Use a separate Git worktree or Worktrunk checkout for dotfiles feature development.' \
                    '' \
                    'After both repositories update successfully, this command:' \
                    '  - Restows ~/dotfiles' \
                    '  - Installs the applicable dependencies and native Neovim plugins' \
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

    set -l working
    set -l success
    set -l warning
    set -l error
    set -l normal
    if test -t 2; and test "$TERM" != dumb
        if not set -q NO_COLOR; or test -z "$NO_COLOR"
            set working (set_color --bold cyan)
            set success (set_color --bold green)
            set warning (set_color --bold yellow)
            set error (set_color --bold red)
            set normal (set_color normal)
        end
    end

    set -l dotfiles "$HOME/dotfiles"
    set -l repos "$HOME/nixos" "$dotfiles"
    set -l had_failure 0
    set -l align_dotfiles 0
    set -l dotfiles_branch

    printf '%sWorking%s  Checking repositories...\n' "$working" "$normal" >&2
    for repo in $repos
        set -l label (string replace -- "$HOME" '~' "$repo")

        if not test -d "$repo"
            printf '%sWarning%s  Skipped %s because the directory does not exist.\n' "$warning" "$normal" "$label" >&2
            printf '  Create %s, then rerun `git_pull_system_repos`.\n' "$label" >&2
            set had_failure 1
            continue
        end

        set -l repo_toplevel (git -C "$repo" rev-parse --show-toplevel 2>/dev/null)
        set -l status_code $status
        if contains -- $status_code 130 143
            return $status_code
        end
        if test $status_code -ne 0
            printf '%sWarning%s  Skipped %s because it is not a Git repository.\n' "$warning" "$normal" "$label" >&2
            printf '  Initialize or restore the repository, then rerun `git_pull_system_repos`.\n' >&2
            set had_failure 1
            continue
        end

        if test (path resolve "$repo_toplevel") != (path resolve "$repo")
            printf '%sWarning%s  Skipped %s because it is not the root of a Git repository.\n' "$warning" "$normal" "$label" >&2
            printf '  Restore the checkout at %s, then rerun `git_pull_system_repos`.\n' "$label" >&2
            set had_failure 1
            continue
        end

        set -l repo_status (git -C "$repo" status --porcelain)
        set status_code $status
        if contains -- $status_code 130 143
            return $status_code
        end
        if test $status_code -ne 0
            printf '%sError%s    Failed to inspect %s.\n' "$error" "$normal" "$label" >&2
            printf '  Run `git -C %s status` before rerunning `git_pull_system_repos`.\n' "$label" >&2
            set had_failure 1
            continue
        end
        if test -n "$repo_status"
            printf '%sWarning%s  Skipped %s because its working tree is dirty.\n' "$warning" "$normal" "$label" >&2
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
                printf '%sError%s    Failed to determine the current dotfiles branch.\n' "$error" "$normal" >&2
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
        printf '%sWarning%s  Repository updates and post-pull setup were skipped because preflight checks failed.\n' "$warning" "$normal" >&2
        return 1
    end

    if test $align_dotfiles -eq 1
        set -l current_branch "$dotfiles_branch"
        if test -z "$current_branch"
            set current_branch 'detached HEAD'
        end

        if test $assume_yes -ne 1
            _git_pull_system_repos_confirm_alignment "$current_branch"
            set -l confirmation_status $status
            if contains -- $confirmation_status 130 143
                return $confirmation_status
            end
            if test $confirmation_status -eq 2
                return 2
            end
            if test $confirmation_status -ne 0
                return 0
            end
        end
    end

    for repo in $repos
        set -l label (string replace -- "$HOME" '~' "$repo")

        if test "$repo" = "$dotfiles"; and test $align_dotfiles -eq 1
            printf '%sWorking%s  Aligning %s with origin/master...\n' "$working" "$normal" "$label" >&2
            git -C "$repo" fetch origin master
            set -l command_status $status
            if contains -- $command_status 130 143
                return $command_status
            end
            if test $command_status -ne 0
                printf '%sError%s    Failed to fetch origin/master for %s.\n' "$error" "$normal" "$label" >&2
                printf '  Restore access to origin, then run `git -C %s fetch origin master`.\n' "$label" >&2
                set had_failure 1
                continue
            end

            git -C "$repo" switch -C master origin/master
            set command_status $status
            if contains -- $command_status 130 143
                return $command_status
            end
            if test $command_status -ne 0
                printf '%sError%s    Failed to align %s with origin/master.\n' "$error" "$normal" "$label" >&2
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
                printf '%sError%s    Failed to set the upstream branch for %s.\n' "$error" "$normal" "$label" >&2
                printf '  Run `git -C %s branch --set-upstream-to=origin/master master`.\n' "$label" >&2
                set had_failure 1
                continue
            end
        end

        printf '%sWorking%s  Pulling %s...\n' "$working" "$normal" "$label" >&2
        git -C "$repo" pull --ff-only
        set -l command_status $status
        if contains -- $command_status 130 143
            return $command_status
        end
        if test $command_status -ne 0
            printf '%sError%s    Failed to pull %s.\n' "$error" "$normal" "$label" >&2
            printf '  Run `git -C %s status` before rerunning `git_pull_system_repos`.\n' "$label" >&2
            set had_failure 1
            continue
        end
        printf '%sSuccess%s  Pulled %s.\n' "$success" "$normal" "$label" >&2
    end

    if test $had_failure -ne 0
        printf '%sWarning%s  Post-pull setup was skipped because one or more repository updates failed.\n' "$warning" "$normal" >&2
        return 1
    end

    bash ~/dotfiles/scripts/secure-pi-agent-dir.sh
    set -l command_status $status
    if contains -- $command_status 130 143
        return $command_status
    end
    if test $command_status -ne 0
        printf '%sError%s    Failed to secure ~/.pi/agent before restowing dotfiles.\n' "$error" "$normal" >&2
        return 1
    end

    printf '%sWorking%s  Restowing ~/dotfiles...\n' "$working" "$normal" >&2
    stow -R -d ~/dotfiles -t ~ .
    set command_status $status
    if contains -- $command_status 130 143
        return $command_status
    end
    if test $command_status -ne 0
        printf '%sError%s    Failed to restow ~/dotfiles.\n' "$error" "$normal" >&2
        printf '  Run `stow -n -R -d ~/dotfiles -t ~ .` to inspect conflicts.\n' >&2
        return 1
    end

    if set -q CORPORATE
        printf '%sWorking%s  Installing shared FBB, Pi, and Fish helper dependencies...\n' "$working" "$normal" >&2
        just --justfile ~/dotfiles/justfile --working-directory ~/dotfiles install-fbb install-fish-libexec install-pi
    else
        printf '%sWorking%s  Installing Pi, OpenCode, and Fish helper dependencies...\n' "$working" "$normal" >&2
        just --justfile ~/dotfiles/justfile --working-directory ~/dotfiles install-fbb install-fish-libexec install-opencode-plugins install-pi
    end
    set command_status $status
    if contains -- $command_status 130 143
        return $command_status
    end
    if test $command_status -ne 0
        printf '%sError%s    Failed to install dependencies.\n' "$error" "$normal" >&2
        if set -q CORPORATE
            printf '  Run `just --justfile ~/dotfiles/justfile --working-directory ~/dotfiles install-fbb install-fish-libexec install-pi` to diagnose the failure.\n' >&2
        else
            printf '  Run `just --justfile ~/dotfiles/justfile --working-directory ~/dotfiles install-fbb install-fish-libexec install-opencode-plugins install-pi` to diagnose the failure.\n' >&2
        end
        return 1
    end

    printf '%sWorking%s  Installing native Neovim plugins and parsers...\n' "$working" "$normal" >&2
    if set -q CORPORATE
        # Ensure Neovim applies corporate plugin policy even when the Fish marker was not exported.
        set --function --export CORPORATE 1
    end
    nvim --headless -i NONE '+TSInstallMissing' '+qa'
    set command_status $status
    printf '\n' >&2
    if contains -- $command_status 130 143
        return $command_status
    end
    if test $command_status -ne 0
        printf '%sError%s    Failed to install native Neovim plugins or parsers.\n' "$error" "$normal" >&2
        printf "  Run `nvim --headless -i NONE '+TSInstallMissing' '+qa'` to diagnose the failure.\n" >&2
        return 1
    end

    printf '%sWorking%s  Linking local Herdr plugins...\n' "$working" "$normal" >&2
    herdr_link_plugins
    set command_status $status
    if contains -- $command_status 130 143
        return $command_status
    end
    if test $command_status -ne 0
        printf '%sError%s    Failed to link local Herdr plugins.\n' "$error" "$normal" >&2
        printf '  Run `herdr_link_plugins` to diagnose the failure.\n' >&2
        return 1
    end

    printf '%sSuccess%s  Updated system repositories and post-pull setup.\n' "$success" "$normal" >&2
end

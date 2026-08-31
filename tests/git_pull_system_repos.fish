#!/usr/bin/env fish

set -g TEST_REPO_ROOT (path resolve (path dirname (status filename))/..)
set -g SYNC_FUNCTION "$TEST_REPO_ROOT/.config/fish/functions/git_pull_system_repos.fish"
set -g TEST_ROOT (mktemp -d)

function cleanup --on-event fish_exit
    command rm -rf "$TEST_ROOT"
end

function fail
    printf 'git_pull_system_repos test failed: %s\n' "$argv" >&2
    exit 1
end

function assert_status
    if test "$argv[1]" != "$argv[2]"
        fail "expected status $argv[1], got $argv[2]"
    end
end

function assert_log_contains
    set -l expected $argv[1]
    if not string match -q -- "*$expected*" (command cat "$TEST_LOG")
        fail "expected $expected in post-pull call log"
    end
end

function assert_log_absent
    set -l unexpected $argv[1]
    if string match -q -- "*$unexpected*" (command cat "$TEST_LOG")
        fail "did not expect $unexpected in post-pull call log"
    end
end

function stow
    printf 'stow %s\n' (string join ' ' -- $argv) >> "$TEST_LOG"
    return "$TEST_STOW_STATUS"
end

function just
    printf 'just %s\n' (string join ' ' -- $argv) >> "$TEST_LOG"
    return "$TEST_JUST_STATUS"
end

function nvim
    printf 'nvim %s\n' (string join ' ' -- $argv) >> "$TEST_LOG"
    if env | string match -q 'CORPORATE=*'
        set -g TEST_NVIM_CORPORATE_EXPORTED 1
    else
        set -g TEST_NVIM_CORPORATE_EXPORTED 0
    end
    return "$TEST_NVIM_STATUS"
end

function herdr_link_plugins
    printf 'herdr_link_plugins\n' >> "$TEST_LOG"
    return "$TEST_HERDR_STATUS"
end

function initialize_repo
    set -l name $argv[1]
    set -l remote "$SCENARIO/remotes/$name.git"
    set -l seed "$SCENARIO/seeds/$name"

    command git init --bare --initial-branch=master "$remote" >/dev/null
    command git init --initial-branch=master "$seed" >/dev/null
    command git -C "$seed" config user.email test@example.com
    command git -C "$seed" config user.name Test
    printf '%s\n' initial > "$seed/$name.txt"
    command git -C "$seed" add .
    command git -C "$seed" commit -m initial >/dev/null
    command git -C "$seed" remote add origin "$remote"
    command git -C "$seed" push --set-upstream origin master >/dev/null
    command git clone "$remote" "$HOME/$name" >/dev/null

    switch $name
        case nixos
            set -g NIXOS_REMOTE "$remote"
        case dotfiles
            set -g DOTFILES_REMOTE "$remote"
    end
end

function add_remote_commit
    set -l name $argv[1]
    set -l remote
    switch $name
        case nixos
            set remote "$NIXOS_REMOTE"
        case dotfiles
            set remote "$DOTFILES_REMOTE"
    end

    set -l writer "$SCENARIO/writers/$name"
    command git clone "$remote" "$writer" >/dev/null
    command git -C "$writer" config user.email test@example.com
    command git -C "$writer" config user.name Test
    printf '%s\n' updated > "$writer/update.txt"
    command git -C "$writer" add .
    command git -C "$writer" commit -m update >/dev/null
    command git -C "$writer" push >/dev/null
end

function setup_scenario
    set -e CORPORATE
    set -g SCENARIO (mktemp -d "$TEST_ROOT/scenario.XXXXXX")
    set -gx HOME "$SCENARIO/home"
    command mkdir -p "$HOME" "$SCENARIO/remotes" "$SCENARIO/seeds" "$SCENARIO/writers"
    initialize_repo nixos
    initialize_repo dotfiles

    set -g TEST_LOG "$SCENARIO/post-pull.log"
    command touch "$TEST_LOG"
    set -g TEST_STOW_STATUS 0
    set -g TEST_JUST_STATUS 0
    set -g TEST_NVIM_STATUS 0
    set -g TEST_NVIM_CORPORATE_EXPORTED 0
    set -g TEST_HERDR_STATUS 0
    source "$SYNC_FUNCTION"
end

function test_corporate_context_reaches_native_plugin_install
    setup_scenario
    set -g CORPORATE 1

    git_pull_system_repos --yes
    assert_status 0 $status
    assert_log_contains install-fbb
    assert_log_contains install-fish-libexec
    assert_log_absent install-opencode-plugins
    assert_status 1 "$TEST_NVIM_CORPORATE_EXPORTED"
end

function test_clean_repositories_fast_forward
    setup_scenario
    add_remote_commit nixos
    add_remote_commit dotfiles

    git_pull_system_repos --yes
    assert_status 0 $status
    assert_status (command git --git-dir "$NIXOS_REMOTE" rev-parse master) (command git -C "$HOME/nixos" rev-parse HEAD)
    assert_status (command git --git-dir "$DOTFILES_REMOTE" rev-parse master) (command git -C "$HOME/dotfiles" rev-parse HEAD)
    assert_status master (command git -C "$HOME/dotfiles" branch --show-current)
    assert_log_contains stow
    assert_log_contains just
    assert_log_contains install-fish-libexec
    assert_log_contains 'nvim --headless -i NONE +TSInstallMissing +qa'
    assert_log_contains herdr_link_plugins
end

function test_dirty_repository_aborts_before_updates
    setup_scenario
    add_remote_commit dotfiles
    set -l nixos_head (command git -C "$HOME/nixos" rev-parse HEAD)
    set -l dotfiles_head (command git -C "$HOME/dotfiles" rev-parse HEAD)
    printf '%s\n' dirty > "$HOME/nixos/dirty.txt"

    git_pull_system_repos
    assert_status 1 $status
    assert_status "$nixos_head" (command git -C "$HOME/nixos" rev-parse HEAD)
    assert_status "$dotfiles_head" (command git -C "$HOME/dotfiles" rev-parse HEAD)
    assert_log_absent stow
    assert_log_absent just
    assert_log_absent nvim
    assert_log_absent herdr_link_plugins
end

function test_non_git_directory_aborts
    setup_scenario
    command rm -rf "$HOME/dotfiles/.git"
    command git init --initial-branch=master "$HOME" >/dev/null

    git_pull_system_repos
    assert_status 1 $status
    assert_log_absent stow
    assert_log_absent just
    assert_log_absent nvim
    assert_log_absent herdr_link_plugins
end

function test_pull_failure_skips_post_pull_setup
    setup_scenario
    command git -C "$HOME/nixos" remote set-url origin "$SCENARIO/missing.git"

    git_pull_system_repos
    assert_status 1 $status
    assert_log_absent stow
    assert_log_absent just
    assert_log_absent nvim
    assert_log_absent herdr_link_plugins
end

function test_noninteractive_feature_branch_requires_yes
    setup_scenario
    command git -C "$HOME/dotfiles" switch --create feature >/dev/null

    git_pull_system_repos
    assert_status 2 $status
    assert_status feature (command git -C "$HOME/dotfiles" branch --show-current)
    assert_log_absent stow
end

function test_feature_branch_declined
    setup_scenario
    command git -C "$HOME/dotfiles" switch --create feature >/dev/null
    function _git_pull_system_repos_confirm_alignment
        return 1
    end

    git_pull_system_repos
    assert_status 0 $status
    assert_status feature (command git -C "$HOME/dotfiles" branch --show-current)
    assert_log_absent stow
end

function test_feature_branch_accepted
    setup_scenario
    command git -C "$HOME/dotfiles" switch --create feature >/dev/null
    add_remote_commit dotfiles
    function _git_pull_system_repos_confirm_alignment
        return 0
    end

    git_pull_system_repos
    assert_status 0 $status
    assert_status master (command git -C "$HOME/dotfiles" branch --show-current)
    assert_status "$DOTFILES_REMOTE" (command git -C "$HOME/dotfiles" remote get-url origin)
    assert_log_contains stow
end

function test_stow_failure_skips_dependencies
    setup_scenario
    set -g TEST_STOW_STATUS 1

    git_pull_system_repos
    assert_status 1 $status
    assert_log_contains stow
    assert_log_absent just
    assert_log_absent nvim
    assert_log_absent herdr_link_plugins
end

function test_native_plugin_install_failure_skips_herdr
    setup_scenario
    set -g TEST_NVIM_STATUS 1

    git_pull_system_repos
    assert_status 1 $status
    assert_log_contains stow
    assert_log_contains just
    assert_log_contains nvim
    assert_log_absent herdr_link_plugins
end

function test_post_pull_failure_returns_nonzero
    setup_scenario
    set -g TEST_HERDR_STATUS 1

    git_pull_system_repos
    assert_status 1 $status
    assert_log_contains stow
    assert_log_contains just
    assert_log_contains nvim
    assert_log_contains herdr_link_plugins
end

test_clean_repositories_fast_forward
test_corporate_context_reaches_native_plugin_install
test_dirty_repository_aborts_before_updates
test_non_git_directory_aborts
test_pull_failure_skips_post_pull_setup
test_noninteractive_feature_branch_requires_yes
test_feature_branch_declined
test_feature_branch_accepted
test_stow_failure_skips_dependencies
test_native_plugin_install_failure_skips_herdr
test_post_pull_failure_returns_nonzero

printf '%s\n' 'git_pull_system_repos lifecycle tests passed'

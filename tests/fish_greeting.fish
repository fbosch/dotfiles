#!/usr/bin/env fish

set -l repo_root (path resolve (path dirname (status filename))/..)
set -g test_home (mktemp -d)
set -g cleanup_pids

function cleanup --on-event fish_exit
    for pid in $cleanup_pids
        command kill $pid 2>/dev/null
    end
    command rm -rf "$test_home"
end

function fail --argument-names message
    printf '%s\n' "$message" >&2
    exit 1
end

set -gx HOME "$test_home"
set -gx XDG_CONFIG_HOME "$test_home/.config"
set -gx XDG_CACHE_HOME "$test_home/.cache"
set -gx XDG_DATA_HOME "$test_home/.local/share"
set -e TERM_PROGRAM
set -e IN_NEOVIM

function uname
    echo Linux
end

source "$repo_root/.config/fish/config.fish"; or fail "Could not source Fish config"

# Keep the real child Fish alive without querying macOS logs or leaving descendants.
mkdir -p "$XDG_CONFIG_HOME/fish/functions"
printf '%s\n' \
    'function first_login_of_the_day' \
    '    exec sleep 30' \
    end >"$XDG_CONFIG_HOME/fish/functions/first_login_of_the_day.fish"

function uname
    echo Darwin
end

function date
    echo 1
end

command sleep 30 &
set -l user_job $last_pid
set -a cleanup_pids $user_job

fish_greeting
set -l login_job $last_pid
set -a cleanup_pids $login_job

test "$login_job" != "$user_job"; or fail "Greeting did not launch the login lookup"
command kill -0 $login_job 2>/dev/null; or fail "Greeting terminated the login lookup"

set -l tracked_jobs (jobs --pid)
test (count $tracked_jobs) -eq 1; or fail "Greeting left a background job that blocks pane restore"
test "$tracked_jobs[1]" = "$user_job"; or fail "Greeting disowned an unrelated job"

printf '%s\n' "PASS: greeting detaches only its login lookup"

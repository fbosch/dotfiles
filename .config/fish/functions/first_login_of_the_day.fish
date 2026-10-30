function first_login_of_the_day
    set -l function_file (path resolve (status filename))
    set -l libexec_dir (path resolve (path dirname "$function_file")/../libexec)
    set -l time (bun --cwd "$libexec_dir" "$libexec_dir/workday_start.ts")
    or return $status

    if not contains -- --silent $argv
        echo "$time"
    end
end

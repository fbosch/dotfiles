function __workitems_extract --description 'Extract work items from git commits for given date range (internal helper)'
    set -l start_date $argv[1]
    set -l end_date $argv[2]
    set -l mode $argv[3]
    set -l refresh $argv[4]

    if test -z "$mode"
        set mode authored_branches
    end

    if test -z "$refresh"
        set refresh 0
    end

    if not command -q bun
        echo "__workitems_extract: bun not found" >&2
        return 1
    end

    set -l helper_dir (path dirname (status filename))
    set -l fish_root (path resolve "$helper_dir/..")
    set -l libexec_dir "$fish_root/libexec"
    set -l helper "azure/workitems_extract.ts"

    if not test -f "$libexec_dir/$helper"
        echo "__workitems_extract: helper not found: $libexec_dir/$helper" >&2
        return 1
    end

    bun --smol --cwd "$libexec_dir" --install=auto "$helper" "$start_date" "$end_date" "$mode" "$refresh"
end

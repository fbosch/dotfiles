function wtfzf --description 'Pick a worktree from wt list with fzf'
    set -l cmd_name wtfzf

    for cmd in wt jq fzf git
        if not command -v $cmd >/dev/null 2>&1
            echo "$cmd_name: '$cmd' is required" >&2
            return 127
        end
    end

    if not git rev-parse --git-dir >/dev/null 2>&1
        echo "$cmd_name: run this from inside a git repository" >&2
        return 1
    end

    set -l tab (printf '\t')
    set -l worktree_rows (
        wt list --format=json $argv \
        | jq -r '
            def clean: gsub("[\t\r\n]"; " ");
            def short(n): if length > n then .[:(n - 3)] + "..." else . end;
            def short_path:
                if . == null then "-"
                else
                    split("/")
                    | map(select(length > 0))
                    | if length <= 3 then join("/") else .[-3:] | join("/") end
                end;

            .[]
            | select(.branch != null)
            | [
                .branch,
                ([
                    (if .is_current then "*" elif .is_previous then "-" else " " end),
                    ((.branch // "-") | short(36)),
                    ((.symbols // "") | short(4)),
                    ((.path // null) | short_path | short(34)),
                    ((.commit.short_sha // "-") | short(8)),
                    ((.commit.message // "") | clean | short(72))
                ] | join("  ")),
                (.path // "-"),
                (if .is_current then "1" else "0" end)
            ]
            | @tsv
        '
    )
    set -l list_exit_code $status

    if test $list_exit_code -ne 0
        echo "$cmd_name: failed to list worktrees" >&2
        return $list_exit_code
    end

    if test -z "$worktree_rows"
        echo "$cmd_name: no worktrees found" >&2
        return 1
    end

    set -l selected (
        printf "%s\n" $worktree_rows \
        | fzf \
            --delimiter="$tab" \
            --with-nth=2 \
            --prompt='wt> ' \
            --height='85%' \
            --layout=reverse \
            --border=rounded \
            --info=inline-right \
            --header='enter: switch worktree' \
            --preview='if [ -z "{3}" ] || [ "{3}" = "-" ] || [ ! -d "{3}" ]; then printf "branch: %s\npath: %s\n\nworktree path unavailable\n" "{1}" "{3}"; exit 0; fi; printf "branch: %s\npath: %s\n\n" "{1}" "{3}"; git -C "{3}" status --short --branch 2>/dev/null; printf "\n"; git -C "{3}" log -1 --pretty=format:"%h %s" 2>/dev/null' \
            --preview-window='down,45%,border-top,wrap' \
            < /dev/tty
    )
    set -l exit_code $status

    if test $exit_code -ne 0 -o -z "$selected"
        return $exit_code
    end

    set -l branch (string split -f 1 $tab -- "$selected")
    set -l is_current (string split -f 4 $tab -- "$selected")

    if test "$is_current" = "1"
        return 0
    end

    wt switch "$branch"
end

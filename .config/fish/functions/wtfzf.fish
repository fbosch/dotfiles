function wtfzf --description 'Pick a worktree from wt list with fzf'
    for cmd in wt jq fzf
        if not command -v $cmd >/dev/null 2>&1
            echo "wtfzf: '$cmd' is required" >&2
            return 127
        end
    end

    set -l tab (printf '\t')
    set -l selected (
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
                ] | join("  "))
            ]
            | @tsv
        ' \
        | fzf \
            --delimiter="$tab" \
            --with-nth=2 \
            --prompt='wt> ' \
            --height='85%' \
            --layout=reverse \
            --border=rounded \
            --info=inline-right \
            --header='enter: switch worktree' \
            < /dev/tty
    )
    set -l exit_code $status

    if test $exit_code -ne 0 -o -z "$selected"
        return $exit_code
    end

    set -l branch (string split -f 1 $tab -- "$selected")
    wt switch "$branch"
end

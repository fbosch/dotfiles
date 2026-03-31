function linear_issue_workflow --description 'Pick Linear issue, switch/create WorkTrunk worktree, open OpenCode workflow'
    set -l cmd_name linear_issue_workflow
    set -l tab (printf '\t')

    for cmd in linear jq fzf wt opencode git
        if not command -v $cmd >/dev/null 2>&1
            echo "$cmd_name: '$cmd' is required" >&2
            return 127
        end
    end

    set -l repo_root (git rev-parse --show-toplevel 2>/dev/null)
    if test -z "$repo_root"
        echo "$cmd_name: run this from inside a git repository" >&2
        return 1
    end

    set -l issue_id ""

    if test (count $argv) -gt 0
        set issue_id (string upper -- $argv[1])
    else
        set -l list_output (env NO_COLOR=1 linear issue list --state triage --state backlog --state unstarted --state started --sort priority --no-pager --limit 100 2>&1)
        set -l list_status $status

        if test $list_status -ne 0
            if string match -q '*Could not determine team key*' -- "$list_output"
                set -l team_output (linear team list 2>&1)
                set -l team_status $status

                if test $team_status -ne 0 -o -z "$team_output"
                    echo "$cmd_name: $list_output" >&2
                    echo "$cmd_name: failed to list teams for fallback selection" >&2
                    return 1
                end

                set -l team_rows
                for line in (string split \n -- (string join \n -- $team_output))
                    set -l trimmed (string trim -- "$line")
                    set -l key (string match -r -g '^([A-Z0-9]+)\s+' -- "$trimmed")

                    if test -z "$key" -o "$key" = "KEY"
                        continue
                    end

                    set -a team_rows "$key$tab$trimmed"
                end

                if test (count $team_rows) -eq 0
                    echo "$cmd_name: $list_output" >&2
                    echo "$cmd_name: failed to parse team key from 'linear team list'" >&2
                    return 1
                end

                set -l team_key ""
                if test (count $team_rows) -eq 1
                    set team_key (string split -f 1 $tab -- "$team_rows[1]")
                else
                    set -l selected_team (
                        printf "%s\n" $team_rows \
                        | fzf \
                            --delimiter="$tab" \
                            --with-nth=2 \
                            --prompt='linear team> ' \
                            --height='40%' \
                            --layout=reverse \
                            --border=rounded \
                            --info=inline-right \
                            --header='enter: choose team for issue list' \
                            < /dev/tty
                    )
                    set -l team_exit_code $status

                    if test $team_exit_code -ne 0 -o -z "$selected_team"
                        return $team_exit_code
                    end

                    set team_key (string split -f 1 $tab -- "$selected_team")
                end

                set list_output (env NO_COLOR=1 linear issue list --state triage --state backlog --state unstarted --state started --sort priority --no-pager --limit 100 --team "$team_key" 2>&1)
                set list_status $status
            end
        end

        if test $list_status -ne 0
            echo "$cmd_name: $list_output" >&2
            return 1
        end

        if test -z "$list_output"
            echo "$cmd_name: no issues returned from 'linear issue list'" >&2
            return 1
        end

        set -l list_text (string join \n -- $list_output)
        set -l issue_lines
        set -l seen_ids

        for line in (string split \n -- $list_text)
            set -l plain_line (string replace -ar '\x1b\[[0-9;]*m' '' -- "$line")
            set -l id (string match -r -g '([A-Z][A-Z0-9]+-[0-9]+)' -- "$plain_line")
            if test -z "$id"
                continue
            end

            if contains -- "$id" $seen_ids
                continue
            end

            set -l detail (string replace -r '^[^A-Z0-9]*[A-Z][A-Z0-9]+-[0-9]+\s+' '' -- "$plain_line")
            set detail (string trim -- "$detail")

            set -a seen_ids "$id"
            set -a issue_lines "$id$tab$detail"
        end

        if test (count $issue_lines) -eq 0
            echo "$cmd_name: failed to parse issue identifiers from 'linear issue list'" >&2
            echo "$cmd_name: raw output from linear issue list:" >&2
            printf "%s\n" $list_output >&2
            return 1
        end

        set -l preview_cmd 'env NO_COLOR=1 linear issue view {1} --no-comments --no-pager'
        if command -v glow >/dev/null 2>&1
            set -l glow_style dark
            if set -q GLOW_STYLE
                set glow_style "$GLOW_STYLE"
            end
            set preview_cmd "env NO_COLOR=1 linear issue view {1} --no-comments --no-pager | glow -s $glow_style -w 120"
        end

        set -l selected (
            printf "%s\n" $issue_lines \
            | fzf \
                --ansi \
                --delimiter="$tab" \
                --with-nth=2 \
                --prompt='linear> ' \
                --height='85%' \
                --layout=reverse \
                --border=rounded \
                --info=inline-right \
                --header='enter: run linear issue workflow' \
                --preview-window='right,65%,border-left,wrap' \
                --preview="$preview_cmd" \
                < /dev/tty
        )
        set -l exit_code $status

        if test $exit_code -ne 0 -o -z "$selected"
            return $exit_code
        end

        set issue_id (string split -f 1 $tab -- "$selected")
    end

    if string match -qr '^[A-Z][A-Z0-9]+-[0-9]+$' -- "$issue_id"
        set issue_id (string upper -- "$issue_id")
    else
        echo "$cmd_name: invalid issue identifier '$issue_id'" >&2
        return 1
    end

    set -l issue_json (linear issue view "$issue_id" --json --no-comments 2>/dev/null)
    if test -z "$issue_json"
        echo "$cmd_name: failed to fetch issue metadata for $issue_id" >&2
        return 1
    end

    set -l branch (printf "%s\n" "$issue_json" | jq -r '.branchName // empty')
    if test -z "$branch"
        set -l title (printf "%s\n" "$issue_json" | jq -r '.title // "work-item"')
        set -l slug (string lower -- "$title")
        set slug (string replace -ar '[^a-z0-9]+' '-' -- "$slug")
        set slug (string replace -ar '-+' '-' -- "$slug")
        set slug (string trim -c '-' -- "$slug")

        if test -z "$slug"
            set slug "work-item"
        end

        set branch "feature/"(string lower -- "$issue_id")"-"(string sub -s 1 -l 48 -- "$slug")
    end

    set -l prompt "/linear-issue $issue_id"

    set -l branch_exists 0
    if git -C "$repo_root" show-ref --verify --quiet "refs/heads/$branch"
        set branch_exists 1
    else if git -C "$repo_root" show-ref --verify --quiet "refs/remotes/origin/$branch"
        set branch_exists 1
    end

    if test $branch_exists -eq 1
        wt -C "$repo_root" switch "$branch" --yes --execute=opencode -- "--prompt" "$prompt"
        return $status
    end

    if functions -q wsc
        wsc "$branch" -- "--prompt" "$prompt"
        return $status
    end

    wt -C "$repo_root" switch --create "$branch" --yes --execute=opencode -- "--prompt" "$prompt"
    return $status
end

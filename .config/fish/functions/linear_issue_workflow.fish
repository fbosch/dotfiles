function linear_issue_workflow --description 'Pick Linear issue, switch/create WorkTrunk worktree, open OpenCode workflow'
    set -l cmd_name linear_issue_workflow
    set -l tab (printf '\t')

    set -l icon_state_triage "󰎔"
    set -l icon_state_backlog "󱥸 "
    set -l icon_state_started "󰪡 "
    set -l icon_state_unstarted "󰄱"
    set -l icon_state_in_review "󰪣 "
    set -l icon_state_completed " "
    set -l icon_state_canceled " "
    set -l icon_state_default "󱞩 "

    set -l icon_priority_1 "󰀧"
    set -l icon_priority_2 "󰢾"
    set -l icon_priority_3 "󰢽"
    set -l icon_priority_4 "󰢼"
    set -l icon_priority_default "󰓎"

    set -l color_state_triage_hex "#FFAB54"
    set -l color_state_backlog_hex "#959DA5"
    set -l color_state_unstarted_hex "#959DA5"
    set -l color_state_started_hex "#ecd21a"
    set -l color_state_in_review_hex "#2dd473"
    set -l color_state_completed_hex "#7D70FF"
    set -l color_state_canceled_hex "#7B828C"
    set -l color_state_default_hex "#969CA3"

    set -l color_priority_1_hex "#FF6F3C"
    set -l color_priority_2_hex "#959DA5"
    set -l color_priority_3_hex "#959DA5"
    set -l color_priority_4_hex "#959DA5"
    set -l color_priority_default_hex "#7B828C"

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
        set -l list_output (env NO_COLOR=1 linear issue list --state triage --state backlog --state unstarted --state started --all-assignees --sort priority --no-pager --limit 0 2>&1)
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

                    if test -z "$key" -o "$key" = KEY
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

                set list_output (env NO_COLOR=1 linear issue list --state triage --state backlog --state unstarted --state started --all-assignees --sort priority --no-pager --limit 0 --team "$team_key" 2>&1)
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
        set -l enrich_limit 40
        set -l enrich_fetch_count 0
        set -l state_col_width 10
        set -l priority_col_width 2
        set -l color_reset (set_color normal)
        set -l color_state_triage (set_color (string sub -s 2 -- "$color_state_triage_hex"))
        set -l color_state_backlog (set_color (string sub -s 2 -- "$color_state_backlog_hex"))
        set -l color_state_unstarted (set_color (string sub -s 2 -- "$color_state_unstarted_hex"))
        set -l color_state_started (set_color (string sub -s 2 -- "$color_state_started_hex"))
        set -l color_state_in_review (set_color (string sub -s 2 -- "$color_state_in_review_hex"))
        set -l color_state_completed (set_color (string sub -s 2 -- "$color_state_completed_hex"))
        set -l color_state_canceled (set_color (string sub -s 2 -- "$color_state_canceled_hex"))
        set -l color_state_default (set_color (string sub -s 2 -- "$color_state_default_hex"))
        set -l color_priority_1 (set_color (string sub -s 2 -- "$color_priority_1_hex"))
        set -l color_priority_2 (set_color (string sub -s 2 -- "$color_priority_2_hex"))
        set -l color_priority_3 (set_color (string sub -s 2 -- "$color_priority_3_hex"))
        set -l color_priority_4 (set_color (string sub -s 2 -- "$color_priority_4_hex"))
        set -l color_priority_default (set_color (string sub -s 2 -- "$color_priority_default_hex"))
        set -l cache_ttl_seconds 300
        set -l cache_dir "$HOME/.cache/linear_issue_workflow"
        set -l cache_file "$cache_dir/issue_meta.tsv"
        set -l cache_now (date +%s 2>/dev/null)
        if test -z "$cache_now"
            set cache_now 0
        end

        set -l cache_ids
        set -l cache_timestamps
        set -l cache_state_names
        set -l cache_state_types
        set -l cache_priorities
        set -l cache_titles
        set -l cache_dirty 0

        if test -f "$cache_file"
            while read -l cache_line
                if test -z "$cache_line"
                    continue
                end

                set -l cache_parts (string split $tab -- "$cache_line")
                if test (count $cache_parts) -lt 6
                    continue
                end

                set -a cache_ids "$cache_parts[1]"
                set -a cache_timestamps "$cache_parts[2]"
                set -a cache_state_names "$cache_parts[3]"
                set -a cache_state_types "$cache_parts[4]"
                set -a cache_priorities "$cache_parts[5]"
                set -a cache_titles "$cache_parts[6]"
            end <"$cache_file"
        end

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

            set -l title "$detail"
            set -l state_name ""
            set -l state_type ""
            set -l priority_value ""

            set -l cache_index (contains -i -- "$id" $cache_ids)
            if test -n "$cache_index"
                set -l cached_timestamp "$cache_timestamps[$cache_index]"
                if string match -qr '^[0-9]+$' -- "$cached_timestamp"
                    set -l cache_age (math "$cache_now - $cached_timestamp")
                    if test $cache_age -le $cache_ttl_seconds
                        set state_name "$cache_state_names[$cache_index]"
                        set state_type "$cache_state_types[$cache_index]"
                        set priority_value "$cache_priorities[$cache_index]"
                        set -l cached_title "$cache_titles[$cache_index]"
                        if test -n "$cached_title"
                            set title "$cached_title"
                        end
                    end
                end
            end

            if test -z "$state_name" -a $enrich_fetch_count -lt $enrich_limit
                set enrich_fetch_count (math "$enrich_fetch_count + 1")
                set -l issue_json_line (linear issue view "$id" --json --no-comments 2>/dev/null)
                if test -n "$issue_json_line"
                    set -l json_title (printf "%s\n" "$issue_json_line" | jq -r '.title // empty')
                    if test -n "$json_title"
                        set title "$json_title"
                    end
                    set state_name (printf "%s\n" "$issue_json_line" | jq -r '.state.name // empty')
                    set state_type (printf "%s\n" "$issue_json_line" | jq -r '.state.type // empty')
                    set priority_value (printf "%s\n" "$issue_json_line" | jq -r '.priority // empty')

                    set -l clean_title (string replace -a $tab ' ' -- "$title")
                    set -l clean_state_name (string replace -a $tab ' ' -- "$state_name")
                    set -l clean_state_type (string replace -a $tab ' ' -- "$state_type")

                    if test -n "$cache_index"
                        set cache_timestamps[$cache_index] "$cache_now"
                        set cache_state_names[$cache_index] "$clean_state_name"
                        set cache_state_types[$cache_index] "$clean_state_type"
                        set cache_priorities[$cache_index] "$priority_value"
                        set cache_titles[$cache_index] "$clean_title"
                    else
                        set -a cache_ids "$id"
                        set -a cache_timestamps "$cache_now"
                        set -a cache_state_names "$clean_state_name"
                        set -a cache_state_types "$clean_state_type"
                        set -a cache_priorities "$priority_value"
                        set -a cache_titles "$clean_title"
                    end
                    set cache_dirty 1
                end
            end

            if test -z "$state_name"
                set state_name (string match -r -g ' - ([^-]+?)\s+[^ ]+\s+[^ ]+\s+ago$' -- "$detail")
            end

            if test -z "$state_name"
                set state_name (string match -r -g ' - ([^-]+?)\s+(yesterday|today|just now)$' -- "$detail")
            end

            if test -z "$state_name"
                set state_name "No State"
            end

            set -l state_key (string lower -- "$state_type")
            if test -z "$state_key"
                set state_key (string lower -- "$state_name")
            end

            set -l state_icon "$icon_state_default"
            set -l state_color "$color_state_default"
            switch "$state_key"
                case triage
                    set state_icon "$icon_state_triage"
                    set state_color "$color_state_triage"
                case backlog
                    set state_icon "$icon_state_backlog"
                    set state_color "$color_state_backlog"
                case unstarted
                    set state_icon "$icon_state_unstarted"
                    set state_color "$color_state_unstarted"
                case started 'in progress'
                    set state_icon "$icon_state_started"
                    set state_color "$color_state_started"
                case 'in review'
                    set state_icon "$icon_state_in_review"
                    set state_color "$color_state_in_review"
                case completed done
                    set state_icon "$icon_state_completed"
                    set state_color "$color_state_completed"
                case canceled cancelled
                    set state_icon "$icon_state_canceled"
                    set state_color "$color_state_canceled"
            end

            set -l priority_icon "$icon_priority_default"
            set -l priority_color "$color_priority_default"
            switch "$priority_value"
                case 1
                    set priority_icon "$icon_priority_1"
                    set priority_color "$color_priority_1"
                case 2
                    set priority_icon "$icon_priority_2"
                    set priority_color "$color_priority_2"
                case 3
                    set priority_icon "$icon_priority_3"
                    set priority_color "$color_priority_3"
                case 4
                    set priority_icon "$icon_priority_4"
                    set priority_color "$color_priority_4"
                case '*'
                    set -l priority_raw (string match -r -g '^\s*([^[:space:]]+)\s+[A-Z][A-Z0-9]+-[0-9]+' -- "$plain_line")
                    switch "$priority_raw"
                        case '⚠⚠⚠'
                            set priority_icon "$icon_priority_1"
                            set priority_color "$color_priority_1"
                        case '▄▆█'
                            set priority_icon "$icon_priority_2"
                            set priority_color "$color_priority_2"
                        case '▄▆'
                            set priority_icon "$icon_priority_3"
                            set priority_color "$color_priority_3"
                        case '▄'
                            set priority_icon "$icon_priority_4"
                            set priority_color "$color_priority_4"
                    end
            end

            set -l padded_state_name (string pad --width $state_col_width -- "$state_name")
            set -l padded_priority_icon (string pad --width $priority_col_width -- "$priority_icon")
            set -l colored_state_icon "$state_color$state_icon$color_reset"
            set -l colored_priority_icon "$priority_color$padded_priority_icon$color_reset"
            set -l display "$colored_state_icon $padded_state_name  $colored_priority_icon  $title"

            set -a seen_ids "$id"
            set -a issue_lines "$id$tab$display$tab$detail"
        end

        if test $cache_dirty -eq 1
            command mkdir -p "$cache_dir" 2>/dev/null
            set -l cache_lines
            for idx in (seq (count $cache_ids))
                set -a cache_lines "$cache_ids[$idx]$tab$cache_timestamps[$idx]$tab$cache_state_names[$idx]$tab$cache_state_types[$idx]$tab$cache_priorities[$idx]$tab$cache_titles[$idx]"
            end
            printf "%s\n" $cache_lines >"$cache_file"
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
                --nth=1,2,3 \
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
            set slug work-item
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
        wt -C "$repo_root" switch "$branch" --yes --execute=opencode -- --prompt "$prompt"
        return $status
    end

    if functions -q wsc
        wsc "$branch" -- --prompt "$prompt"
        return $status
    end

    wt -C "$repo_root" switch --create "$branch" --yes --execute=opencode -- --prompt "$prompt"
    return $status
end

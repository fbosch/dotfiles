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

    for cmd in linear fzf wt opencode git bun
        if not command -v $cmd >/dev/null 2>&1
            echo "$cmd_name: '$cmd' is required" >&2
            return 127
        end
    end

    set -l helper_dir (path dirname (status filename))
    set -l fish_root (path resolve "$helper_dir/..")
    set -l libexec_dir "$fish_root/libexec"
    set -l helper "$libexec_dir/opencode/linear_issue_workflow_helper.ts"
    if not test -f "$helper"
        echo "$cmd_name: helper not found: $helper" >&2
        return 1
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
        set -l list_output (env NO_COLOR=1 linear issue query --all-teams --state triage --state backlog --state unstarted --state started --all-assignees --sort priority --no-pager --limit 0 2>&1)
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

                set list_output (env NO_COLOR=1 linear issue query --state triage --state backlog --state unstarted --state started --all-assignees --sort priority --no-pager --limit 0 --team "$team_key" 2>&1)
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

        set -l issue_lines
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

        set -l helper_rows (printf "%s\n" $list_output | bun --cwd "$libexec_dir" "$helper" build-list)
        set -l helper_status $status
        if test $helper_status -ne 0 -o -z "$helper_rows"
            echo "$cmd_name: failed to build issue list rows" >&2
            echo "$cmd_name: raw output from linear issue list:" >&2
            printf "%s\n" $list_output >&2
            return 1
        end

        for row in $helper_rows
            set -l parts (string split $tab -- "$row")
            if test (count $parts) -lt 6
                continue
            end

            set -l id "$parts[1]"
            set -l state_name "$parts[2]"
            set -l state_key "$parts[3]"
            set -l priority_value "$parts[4]"
            set -l title "$parts[5]"
            set -l detail "$parts[6]"

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
            end

            set -l padded_state_name (string pad --width $state_col_width -- "$state_name")
            set -l padded_priority_icon (string pad --width $priority_col_width -- "$priority_icon")
            set -l colored_state_icon "$state_color$state_icon$color_reset"
            set -l colored_priority_icon "$priority_color$padded_priority_icon$color_reset"
            set -l display "$colored_state_icon $padded_state_name  $colored_priority_icon  $title"
            set -a issue_lines "$id$tab$display$tab$detail"
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

    set -l branch (bun --cwd "$libexec_dir" "$helper" issue-branch "$issue_id")
    if test $status -ne 0 -o -z "$branch"
        echo "$cmd_name: failed to derive branch for $issue_id" >&2
        return 1
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

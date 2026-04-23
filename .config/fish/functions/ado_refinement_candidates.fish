function ado_refinement_candidates --description 'Pick Azure DevOps refinement candidates for next sprint and open OpenCode'
    argparse -n ado_refinement_candidates c/context= t/team= r/refresh -- $argv
    or return

    for cmd in bun fzf opencode az
        if not command -v $cmd >/dev/null 2>&1
            echo "ado_refinement_candidates: '$cmd' is required" >&2
            return 127
        end
    end

    set -l helper_dir (path dirname (status filename))
    set -l fish_root (path resolve "$helper_dir/..")
    set -l libexec_dir "$fish_root/libexec"
    set -l helper "$libexec_dir/azure/ado_refinement_candidates.ts"
    if not test -f "$helper"
        echo "ado_refinement_candidates: helper not found: $helper" >&2
        return 1
    end

    set -l context_arg ""
    if set -q _flag_context
        set context_arg "$_flag_context"
    end

    set -l team_arg ""
    if set -q _flag_team
        set team_arg "$_flag_team"
    end

    set -l refresh_flag 0
    if set -q _flag_refresh
        set refresh_flag 1
    end

    set -l invocation_cwd "$PWD"

    set -l list_lines (FISH_LIBEXEC_CWD="$invocation_cwd" bun --cwd "$libexec_dir" "$helper" list "$context_arg" "$team_arg" "$refresh_flag")
    if test (count $list_lines) -eq 0
        echo "ado_refinement_candidates: helper returned no output" >&2
        return 1
    end

    if string match -q 'ERROR:*' -- "$list_lines[1]"
        echo "$list_lines[1]"
        return 1
    end

    set -l cache_file ""
    set -l summary ""
    set -l candidate_lines
    set -l team_prompt ""
    set -l team_choice_lines

    for line in $list_lines
        set -l parts (string split -m 1 \t -- "$line")
        if test (count $parts) -lt 2
            continue
        end

        switch "$parts[1]"
            case CACHE_FILE
                set cache_file "$parts[2]"
            case SUMMARY
                set summary "$parts[2]"
            case TEAM_PROMPT
                set team_prompt "$parts[2]"
            case TEAM_OPTION
                set -a team_choice_lines "$line"
            case '*'
                set -a candidate_lines "$line"
        end
    end

    if test -z "$cache_file" -a (count $team_choice_lines) -gt 0
        if not command -v gum >/dev/null 2>&1
            echo "ado_refinement_candidates: 'gum' is required for team selection" >&2
            return 127
        end

        set -l team_display_lines
        set -l team_labels
        for line in $team_choice_lines
            set -l parts (string split \t -- "$line")
            if test (count $parts) -lt 2
                continue
            end

            set -l team_name "$parts[2]"
            set -l team_description ""
            if test (count $parts) -ge 3
                set team_description "$parts[3]"
            end

            set -l display "$team_name"
            if test -n "$team_description"
                set display "$team_name | $team_description"
            end

            set -a team_labels "$display"
            set -a team_display_lines "$team_name\t$display"
        end

        set -l chosen_label (printf "%s\n" $team_labels | gum choose --header "$team_prompt")
        if test -z "$chosen_label"
            return 0
        end

        for line in $team_display_lines
            set -l parts (string split \t -- "$line")
            if test (count $parts) -lt 2
                continue
            end

            if test "$parts[2]" = "$chosen_label"
                set team_arg "$parts[1]"
                break
            end
        end

        if test -z "$team_arg"
            echo "ado_refinement_candidates: failed to map selected team label" >&2
            return 1
        end

        set list_lines (FISH_LIBEXEC_CWD="$invocation_cwd" bun --cwd "$libexec_dir" "$helper" list "$context_arg" "$team_arg" "$refresh_flag")
        if test (count $list_lines) -eq 0
            echo "ado_refinement_candidates: helper returned no output" >&2
            return 1
        end

        if string match -q 'ERROR:*' -- "$list_lines[1]"
            echo "$list_lines[1]"
            return 1
        end

        set cache_file ""
        set summary ""
        set candidate_lines
        for line in $list_lines
            set -l parts (string split -m 1 \t -- "$line")
            if test (count $parts) -lt 2
                continue
            end

            switch "$parts[1]"
                case CACHE_FILE
                    set cache_file "$parts[2]"
                case SUMMARY
                    set summary "$parts[2]"
                case '*'
                    set -a candidate_lines "$line"
            end
        end
    end

    if test -z "$cache_file"
        echo "ado_refinement_candidates: cache file missing from helper output" >&2
        return 1
    end

    if test (count $candidate_lines) -eq 0
        if test -n "$summary"
            echo "$summary"
            return 0
        end

        echo "No refinement candidates found"
        return 0
    end

    set -l escaped_libexec (string escape --style=script -- "$libexec_dir")
    set -l escaped_helper (string escape --style=script -- "$helper")
    set -l escaped_cache (string escape --style=script -- "$cache_file")
    set -l escaped_invocation_cwd (string escape --style=script -- "$invocation_cwd")
    set -l preview_cmd "FISH_LIBEXEC_CWD=$escaped_invocation_cwd bun --cwd $escaped_libexec $escaped_helper preview $escaped_cache {1}"

    set -l selected (
        printf "%s\n" $candidate_lines \
        | fzf \
            --multi \
            --delimiter='\t' \
            --with-nth=2 \
            --prompt='ado refine> ' \
            --height='85%' \
            --layout=reverse \
            --border=rounded \
            --info=inline-right \
            --header='tab: toggle selection, enter: open in OpenCode' \
            --preview-window='right,65%,border-left,wrap' \
            --preview="$preview_cmd" \
            < /dev/tty
    )
    set -l exit_code $status
    if test $exit_code -ne 0 -o -z "$selected"
        return $exit_code
    end

    set -l selected_ids
    for line in $selected
        set -a selected_ids (string split -f 1 \t -- "$line")
    end

    set -l prompt (FISH_LIBEXEC_CWD="$invocation_cwd" bun --cwd "$libexec_dir" "$helper" prompt "$cache_file" $selected_ids)
    if test -z "$prompt"
        echo "ado_refinement_candidates: prompt generation returned no output" >&2
        return 1
    end

    if string match -q 'ERROR:*' -- "$prompt[1]"
        echo "$prompt[1]"
        return 1
    end

    opencode --prompt "$prompt"
end

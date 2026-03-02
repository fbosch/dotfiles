function ai_commit --description 'Generate AI-powered Commitizen commit message from branch context'
    argparse d/dry v/verbose 'm/model=' -- $argv
    or return 1

    set -l dry_run (set -q _flag_dry; and echo true; or echo false)
    set -l ai_model (set -q _flag_model; and echo $_flag_model; or echo opencode/big-pickle)
    set -l fallback_model github-copilot/grok-code-fast-1 # anthropic/claude-haiku-4-5

    if not git rev-parse --git-dir >/dev/null 2>&1
        gum style " Not in a git repository"
        return 1
    end
    set -l staged_files (git diff --cached --name-only)
    if test -z "$staged_files"
        gum style " No staged changes to commit"
        return 1
    end

    if set -q _flag_verbose
        echo "Model: $ai_model"
        echo "Fallback: $fallback_model"
        echo "Branch: "(git rev-parse --abbrev-ref HEAD)
    end

    set -l temp_output (mktemp -t opencode_output.XXXXXX)
    set -l git_dir (git rev-parse --absolute-git-dir)
    set -l git_work_tree (git rev-parse --show-toplevel)
    # Only set GIT_WORK_TREE for linked worktrees; regular repos error if GIT_WORK_TREE is set
    set -l git_work_tree_arg ""
    if not string match -q "$git_work_tree*" "$git_dir"
        set git_work_tree_arg $git_work_tree
    end

    function __ai_commit_extract -S
        cat $temp_output | sed 's/\x1b\[[0-9;]*m//g' | grep '^{' \
            | jq -r 'select(.type == "text") | .part.text' 2>/dev/null \
            | tail -n 1 | string trim
    end

    # Run with primary model
    set -l current_model $ai_model
    gum spin --spinner pulse --title "󰚩 Analyzing changes with $current_model..." -- \
        fish -c 'set -x GIT_DIR $argv[3]; test -n "$argv[4]"; and set -x GIT_WORK_TREE $argv[4]; opencode_transient_run run --command commit-msg -m $argv[1] --format json > $argv[2] 2>/dev/null' \
        -- "$current_model" "$temp_output" "$git_dir" "$git_work_tree_arg"

    set -l raw_output (__ai_commit_extract)

    # Fallback if empty
    if test -z "$raw_output"
        set current_model $fallback_model
        gum spin --spinner pulse --title "󰚩 Retrying with $current_model..." -- \
            fish -c 'set -x GIT_DIR $argv[3]; test -n "$argv[4]"; and set -x GIT_WORK_TREE $argv[4]; opencode_transient_run run --command commit-msg -m $argv[1] --format json > $argv[2] 2>/dev/null' \
            -- "$current_model" "$temp_output" "$git_dir" "$git_work_tree_arg"
        set raw_output (__ai_commit_extract)
    end

    rm -f $temp_output
    functions -e __ai_commit_extract

    if test -z "$raw_output"
        gum style " Failed to generate commit message"
        return 1
    end

    set -l commit_msg (__extract_commit_msg "$raw_output")

    if test -z "$commit_msg"
        gum style " Failed to extract valid commit message"
        gum style --foreground 3 "Raw output:"
        echo "$raw_output"
        return 1
    end

    set -l msg_length (string length -- "$commit_msg")
    if test "$msg_length" -gt 50
        gum style --foreground 3 " Message is $msg_length chars (over 50)"
        gum style --foreground 6 "Generated message:"
        gum style --foreground 208 "  $commit_msg"
        if test "$current_model" != "$fallback_model"
            set -l retry_label "Retry with $fallback_model"
            set -l length_action (gum choose --header "Pick an action" "Edit current message" "$retry_label" "Cancel")
            if test $status -ne 0
                gum style --foreground 1 "󰜺 Commit cancelled"
                return 1
            end

            if test "$length_action" = "$retry_label"
                set current_model $fallback_model
                set -l temp_output2 (mktemp -t opencode_output.XXXXXX)
                gum spin --spinner pulse --title "󰚩 Retrying with $current_model..." -- \
                    fish -c 'set -x GIT_DIR $argv[3]; test -n "$argv[4]"; and set -x GIT_WORK_TREE $argv[4]; opencode_transient_run run --command commit-msg -m $argv[1] --format json > $argv[2] 2>/dev/null' \
                    -- "$current_model" "$temp_output2" "$git_dir" "$git_work_tree_arg"
                set -l raw2 (cat $temp_output2 | sed 's/\x1b\[[0-9;]*m//g' | grep '^{' \
                    | jq -r 'select(.type == "text") | .part.text' 2>/dev/null \
                    | tail -n 1 | string trim)
                rm -f $temp_output2

                if test -z "$raw2"
                    gum style --foreground 1 " Failed to generate commit message with $current_model"
                    return 1
                end

                set commit_msg (__extract_commit_msg "$raw2")
                if test -z "$commit_msg"
                    gum style --foreground 1 " Failed to extract valid commit message from $current_model"
                    return 1
                end

                set msg_length (string length -- "$commit_msg")
                if test "$msg_length" -gt 50
                    gum style --foreground 3 " Message is $msg_length chars (over 50) — edit before committing"
                end
            else if test "$length_action" = "Cancel"
                gum style --foreground 1 "󰜺 Commit cancelled"
                return 1
            end
        else
            gum style --foreground 3 " Edit before committing"
        end
    end

    set -l edited_msg (gum input --value="$commit_msg" --width 100 --prompt "󰏫 " --placeholder "Edit commit message or press Enter to accept...")
    if test $status -ne 0
        gum style --foreground 1 "󰜺 Commit cancelled"
        return 1
    end
    if test -z "$edited_msg"
        gum style --foreground 1 "󰜺 Commit cancelled (empty message)"
        return 1
    end

    gum style --foreground 208 "$edited_msg"

    # Cross-platform clipboard copy
    set -l clipboard_cmd pbcopy
    if test (uname) != Darwin
        if command -v wl-copy >/dev/null 2>&1
            set clipboard_cmd wl-copy
        else if command -v xclip >/dev/null 2>&1
            set clipboard_cmd "xclip -selection clipboard"
        else
            set clipboard_cmd ""
        end
    end
    if test -n "$clipboard_cmd"
        printf "git commit -m \"%s\"" "$edited_msg" | eval $clipboard_cmd
    end

    if test "$dry_run" = true
        gum style --foreground 6 "🔍 Dry run - would execute:"
        gum style --foreground 2 "  git commit -m \"$edited_msg\""
        gum style --foreground 6 "\nStaged files:"
        git diff --cached --name-only | sed 's/^/  /'
        return 0
    end

    history add git\ commit\ -m\ "$edited_msg" >/dev/null 2>&1
    git commit -m "$edited_msg"
    set -l commit_status $status

    if test $commit_status -eq 0
        gum style --foreground 2 "󰸞 Commit successful!"
    else
        gum style --foreground 1 "󱎘 Commit failed"
        return 1
    end
end

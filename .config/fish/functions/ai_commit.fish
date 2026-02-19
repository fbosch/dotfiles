function ai_commit --description 'Generate AI-powered Commitizen commit message from branch context'
    argparse d/dry v/verbose 'm/model=' -- $argv
    or return 1

    set -l dry_run (set -q _flag_dry; and echo true; or echo false)
    set -l ai_model (set -q _flag_model; and echo $_flag_model; or echo github-copilot/grok-code-fast-1)
    set -l fallback_model github-copilot/claude-haiku-4.5

    if not git rev-parse --git-dir >/dev/null 2>&1
        gum style " Not in a git repository"
        return 1
    end
    set -l staged_files (git diff --cached --name-only)
    if test -z "$staged_files"
        gum style " No staged changes to commit"
        return 1
    end

    # Extract branch context to pass as command arguments
    set -l branch_name (git rev-parse --abbrev-ref HEAD)
    set -l ticket_number ""
    if string match -qr '\d+' $branch_name
        set ticket_number (string match -r '\d+' $branch_name)
    end
    set -l branch_hint ""
    if string match -qr '^([a-z]+)/' $branch_name
        set branch_hint (string match -r '^[a-z]+' $branch_name)
    end

    if set -q _flag_verbose
        echo "Model: $ai_model"
        echo "Fallback: $fallback_model"
        echo "Branch: $branch_name"
        test -n "$branch_hint"; and echo "Branch type: $branch_hint"
        test -n "$ticket_number"; and echo "Ticket: $ticket_number"
    end

    # Build args string: branch name + ticket if found
    set -l cmd_args "$branch_name"
    if test -n "$ticket_number"
        set cmd_args "$cmd_args ticket:$ticket_number"
    end
    if test -n "$branch_hint"
        set cmd_args "$cmd_args type:$branch_hint"
    end

    # Capture existing sessions before running (for cleanup)
    set -l sessions_before (opencode session list --format json -n 100 2>/dev/null | jq -r '.[] | "\(.projectId)/\(.id)"' 2>/dev/null)

    # Set up cleanup on interrupt (SIGINT/SIGTERM)
    # Note: SIGKILL (kill -9) cannot be trapped by any process
    function __ai_commit_cleanup --on-signal SIGINT --on-signal SIGTERM
        set -l sessions_after (opencode session list --format json -n 100 2>/dev/null | jq -r '.[] | "\(.projectId)/\(.id)"' 2>/dev/null)
        for session_path in $sessions_after
            if not contains $session_path $sessions_before
                cleanup_opencode_session "$session_path" 2>/dev/null
                break
            end
        end
        functions -e __ai_commit_cleanup
    end

    set -l temp_output (mktemp -t opencode_output.XXXXXX)

    # Run with primary model
    set -l current_model $ai_model
    gum spin --spinner pulse --title "󰚩 Analyzing changes with $current_model..." -- \
        sh -c "opencode run --command commit-msg -m $current_model --format json '$cmd_args' 2>/dev/null > $temp_output"
    
    set -l raw_output (cat $temp_output | sed 's/\x1b\[[0-9;]*m//g' | grep '^{' | jq -r 'select(.type == "text") | .part.text' 2>/dev/null | tail -n 1 | string trim)

    # Fallback if empty
    if test -z "$raw_output"
        set current_model $fallback_model
        gum spin --spinner pulse --title "󰚩 Retrying with $current_model..." -- \
            sh -c "opencode run --command commit-msg -m $current_model --format json '$cmd_args' 2>/dev/null > $temp_output"
        set raw_output (cat $temp_output | sed 's/\x1b\[[0-9;]*m//g' | grep '^{' | jq -r 'select(.type == "text") | .part.text' 2>/dev/null | tail -n 1 | string trim)
    end

    rm -f $temp_output

    # Determine the new session created by this run
    set -l sessions_after (opencode session list --format json -n 100 2>/dev/null | jq -r '.[] | "\(.projectId)/\(.id)"' 2>/dev/null)
    set -l used_session_path ""
    for session_path in $sessions_after
        if not contains $session_path $sessions_before
            set used_session_path $session_path
            break
        end
    end

    # Cleanup the session before proceeding
    if test -n "$used_session_path"
        if set -q _flag_verbose
            cleanup_opencode_session --verbose "$used_session_path"
        else
            cleanup_opencode_session "$used_session_path" 2>/dev/null
        end
    end

    if test -z "$raw_output"
        gum style " Failed to generate commit message"
        functions -e __ai_commit_cleanup 2>/dev/null
        return 1
    end

    # Extract conventional commit line
    set -l commit_msg ""
    set -l cleaned (echo "$raw_output" | sed 's/```[a-z]*//g' | string trim)
    for line in (echo "$cleaned" | string split "\n")
        test -z "$line"; and continue
        if string match -qr '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\([^)]+\))?: ' -- "$line"
            set commit_msg "$line"
            break
        end
    end
    # Fallback: first non-empty line
    if test -z "$commit_msg"
        set commit_msg (echo "$cleaned" | string split "\n" | string match -r '^\S.*' | head -n 1)
    end

    if test -z "$commit_msg"
        gum style " Failed to extract valid commit message"
        gum style --foreground 3 "Raw output:"
        echo "$raw_output"
        functions -e __ai_commit_cleanup 2>/dev/null
        return 1
    end

    # Retry with fallback if too long and haven't already
    set -l msg_length (string length -- "$commit_msg")
    if test "$msg_length" -gt 50 -a "$current_model" != "$fallback_model"
        set current_model $fallback_model
        set -l temp_output2 (mktemp -t opencode_output.XXXXXX)
        gum spin --spinner pulse --title "󰚩 Retrying with $current_model..." -- \
            sh -c "opencode run --command commit-msg -m $current_model --format json '$cmd_args' 2>/dev/null > $temp_output2"
        set -l raw2 (cat $temp_output2 | sed 's/\x1b\[[0-9;]*m//g' | grep '^{' | jq -r 'select(.type == "text") | .part.text' 2>/dev/null | tail -n 1 | string trim)
        rm -f $temp_output2
        if test -n "$raw2"
            set cleaned (echo "$raw2" | sed 's/```[a-z]*//g' | string trim)
            set commit_msg ""
            for line in (echo "$cleaned" | string split "\n")
                test -z "$line"; and continue
                if string match -qr '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\([^)]+\))?: ' -- "$line"
                    set commit_msg "$line"
                    break
                end
            end
            test -z "$commit_msg"
                and set commit_msg (echo "$cleaned" | string split "\n" | string match -r '^\S.*' | head -n 1)
            set msg_length (string length -- "$commit_msg")
        end
    end

    if test "$msg_length" -gt 50
        gum style --foreground 3 "⚠ Generated message too long ($msg_length chars, max 50)"
        set commit_msg (string sub -l 47 -- "$commit_msg")"..."
    end

    set -l edited_msg (gum input --value="$commit_msg" --width 100 --prompt "󰏫 " --placeholder "Edit commit message or press Enter to accept...")
    if test $status -ne 0
        gum style --foreground 1 "󰜺 Commit cancelled"
        functions -e __ai_commit_cleanup 2>/dev/null
        return 1
    end
    if test -z "$edited_msg"
        gum style --foreground 1 "󰜺 Commit cancelled (empty message)"
        functions -e __ai_commit_cleanup 2>/dev/null
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
        functions -e __ai_commit_cleanup 2>/dev/null
        return 0
    end

    history add git\ commit\ -m\ "$edited_msg" >/dev/null 2>&1
    git commit -m "$edited_msg"
    set -l commit_status $status
    
    # Remove signal handler
    functions -e __ai_commit_cleanup 2>/dev/null
    
    if test $commit_status -eq 0
        gum style --foreground 2 "󰸞 Commit successful!"
    else
        gum style --foreground 1 "󱎘 Commit failed"
        return 1
    end
end

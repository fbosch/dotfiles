function ai_commit --description 'Generate AI-powered Commitizen commit message from branch context'
    # Parse arguments
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

    # Get branch context
    set branch_name (git rev-parse --abbrev-ref HEAD)
    set ticket_number ""
    if string match -qr '(\d+)' $branch_name
        set ticket_number (string match -r '\d+' $branch_name)
    end
    set branch_hint ""
    if string match -qr '^([a-z]+)/' $branch_name
        set branch_hint (string match -r '^([a-z]+)/' $branch_name | string split '/')[1]
    end

    # Get recent commit for context (helps AI understand the narrative)
    set -l last_commit_msg ""
    set -l commit_count (git rev-list --count HEAD 2>/dev/null)
    if test "$commit_count" -gt 0
        set last_commit_msg (git log -1 --pretty=format:"%s" 2>/dev/null)
    end

    # Generate the diff - focus on staged changes against HEAD
    set temp_diff (mktemp -t commit_diff.XXXXXX)
    git diff --cached >$temp_diff

    # Build the prompt focusing on atomic changes
    set temp_prompt (mktemp -t opencode_prompt.XXXXXX)
    echo "🚨 CRITICAL: OUTPUT MUST BE EXACTLY ≤50 CHARACTERS TOTAL 🚨

Generate a Commitizen commit message for staged changes.

ABSOLUTE REQUIREMENTS:
1. Maximum 50 characters TOTAL (count: type + scope + colon + space + subject)
2. Format: <type>(<scope>): <subject>
3. Output ONLY the commit message - NO explanations, NO markdown, NO thinking
4. If >50 chars, you MUST abbreviate until ≤50

CONTEXT:
Branch: $branch_name" >$temp_prompt

    if test -n "$last_commit_msg"
        echo "Previous commit: $last_commit_msg" >>$temp_prompt
    end

    if test -n "$branch_hint"
        echo "Branch type: $branch_hint" >>$temp_prompt
    end
    if test -n "$ticket_number"
        echo "Ticket: $ticket_number" >>$temp_prompt
    end
    set -l skill_dir "$HOME/.config/opencode/skills/ai-commit"
    set -l skill_file "$skill_dir/SKILL.md"
    if not test -f "$skill_file"
        set skill_file "$skill_dir/skill.md"
    end
    if not test -f "$skill_file"
        gum style --foreground 1 " Skill not found: $skill_dir/SKILL.md"
        rm -f $temp_prompt $temp_diff
        return 1
    end
    set -l skill_body (sed '1,/^---$/d' "$skill_file" | sed '1,/^---$/d')
    if test -z "$skill_body"
        set skill_body (cat "$skill_file")
    end
    echo "
$skill_body

STAGED DIFF (focus on THIS change):
" >>$temp_prompt

    cat $temp_diff >>$temp_prompt

    if set -q _flag_verbose
        echo "Model: $ai_model"
        echo "Fallback model: $fallback_model"
        echo "Branch: $branch_name"
        if test -n "$branch_hint"
            echo "Branch type: $branch_hint"
        end
        if test -n "$ticket_number"
            echo "Ticket: $ticket_number"
        end
        if test -n "$last_commit_msg"
            echo "Previous commit: $last_commit_msg"
        end
        echo "Skill file: $skill_file"
    end

    # Capture existing sessions before running (for cleanup)
    set -l sessions_before (opencode session list --format json -n 100 2>/dev/null | jq -r '.[] | "\(.projectId)/\(.id)"' 2>/dev/null)


    # Run AI generation with fallback
    set temp_output (mktemp -t opencode_output.XXXXXX)
    set current_model $ai_model
    gum spin --spinner pulse --title "󰚩 Analyzing changes with $current_model..." -- sh -c "cat $temp_prompt | opencode run -m $current_model --format json 2>/dev/null > $temp_output"

    # Extract output - get ONLY the final text message (skip thinking/intermediate outputs)
    # The JSON output is newline-delimited, with each line being a separate event
    # We want only "text" type events, and we'll take the LAST one as the final answer
    set raw_output (cat $temp_output | sed 's/\x1b\[[0-9;]*m//g' | jq -r 'select(.type == "text") | .part.text' 2>/dev/null | tail -n 1 | string trim)

    # If jq parsing failed, try plain text extraction
    if test -z "$raw_output"
        set raw_output (cat $temp_output | sed 's/\x1b\[[0-9;]*m//g' | string collect | string trim)
    end

    # Try fallback model if primary failed
    if test -z "$raw_output"
        set current_model $fallback_model
        gum spin --spinner pulse --title "󰚩 Retrying with $current_model..." -- sh -c "cat $temp_prompt | opencode run -m $current_model --format json 2>/dev/null > $temp_output"

        # Extract with same logic - last text message only
        set raw_output (cat $temp_output | sed 's/\x1b\[[0-9;]*m//g' | jq -r 'select(.type == "text") | .part.text' 2>/dev/null | tail -n 1 | string trim)

        # Try plain text extraction for fallback too
        if test -z "$raw_output"
            set raw_output (cat $temp_output | sed 's/\x1b\[[0-9;]*m//g' | string collect | string trim)
        end
    end

    if test -z "$raw_output"
        gum style " Failed to generate commit message"
        rm -f $temp_prompt $temp_output $temp_diff
        return 1
    end

    # Debug: show what we got
    if set -q DEBUG_AI_COMMIT
        gum style --foreground 6 "=== DEBUG: Raw AI Output ==="
        echo "$raw_output"
        gum style --foreground 6 "=== END DEBUG ==="
    end

    rm -f $temp_prompt $temp_output $temp_diff

    # Extract valid commit message (first line matching conventional commit format)
    # Remove any markdown formatting, code blocks, or extra text
    set cleaned_output (echo "$raw_output" | sed 's/```[a-z]*//g' | sed 's/^[[:space:]]*//g' | string collect)

    # Try to extract just the commit message line
    set commit_msg ""
    for line in (echo "$cleaned_output" | string split "\n")
        # Skip empty lines
        if test -z "$line"
            continue
        end
        # Look for conventional commit format
        if string match -qr '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\([^)]+\))?: ' -- "$line"
            set commit_msg "$line"
            break
        end
    end

    # Fallback: take first non-empty line
    if test -z "$commit_msg"
        set commit_msg (echo "$cleaned_output" | string split "\n" | string match -r '^\S.*' | head -n 1)
    end

    if test -z "$commit_msg"
        gum style " Failed to extract valid commit message"
        gum style --foreground 3 "Raw output:"
        echo "$raw_output"
        return 1
    end

    # Validate length (max 50 chars for subject line)
    set msg_length (string length -- "$commit_msg")
    if test -n "$msg_length" -a "$msg_length" -gt 50
        gum style --foreground 3 "⚠ Generated message too long ($msg_length chars, max 50)"
        # Try to truncate intelligently at word boundary
        set commit_msg (string sub -l 47 -- "$commit_msg")"..."
    end

    # Determine the new session created by this run
    set -l sessions_after (opencode session list --format json -n 100 2>/dev/null | jq -r '.[] | "\(.projectId)/\(.id)"' 2>/dev/null)
    set -l used_session_path ""
    for session_path in $sessions_after
        if not contains $session_path $sessions_before
            set used_session_path $session_path
            break
        end
    end

    # Cleanup the session used for generation before prompting
    if test -z "$used_session_path"
        if set -q _flag_verbose
            echo "Cleanup skipped: session id not found"
        end
    else
        if set -q _flag_verbose
            echo "Session path: $used_session_path"
        end
        if set -q _flag_verbose
            cleanup_opencode_session --verbose "$used_session_path"
        else
            cleanup_opencode_session "$used_session_path"
        end
    end

    set edited_msg (gum input --value="$commit_msg" --width 100 --prompt "󰏫 " --placeholder "Edit commit message or press Enter to accept...")
    if test $status -ne 0
        gum style --foreground 1 "󰜺 Commit cancelled"
        return 1
    end
    if test -z "$edited_msg"
        gum style --foreground 1 "󰜺 Commit cancelled (empty message)"
        return 1
    end

    gum style --foreground 208 "$edited_msg"

    # Dry run mode - just show what would be committed
    if test "$dry_run" = true
        gum style --foreground 6 "🔍 Dry run - would execute:"
        gum style --foreground 2 "  git commit -m \"$edited_msg\""
        gum style --foreground 6 "\nStaged files:"
        git diff --cached --name-only | sed 's/^/  /'
        return 0
    end

    # Add the commit command to shell history before executing
    # This allows easy re-run if pre-commit hooks fail
    history add git\ commit\ -m\ "$edited_msg" >/dev/null 2>&1
    git commit -m "$edited_msg"
    set -l commit_status $status

    # Cleanup sessions
    if test $commit_status -eq 0
        gum style --foreground 2 "󰸞 Commit successful!"
        return 0
    else
        gum style --foreground 1 "󱎘 Commit failed"
        return 1
    end
end

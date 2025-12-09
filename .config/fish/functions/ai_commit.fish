function ai_commit --description 'Generate AI-powered Commitizen commit message from branch context'
    set -l ai_model opencode/grok-code
    set -l fallback_model github-copilot/grok-code-fast-1
    
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
    echo "Generate Commitizen commit message for STAGED changes only.

CONTEXT:
Branch: $branch_name" >$temp_prompt
    
    if test -n "$last_commit_msg"
        echo "Previous commit: $last_commit_msg" >>$temp_prompt
    end
    
    if test -n "$branch_hint"
        echo "Branch type: $branch_hint" >>$temp_prompt
    end
    
    echo "
RULES:
- Types: feat|fix|docs|style|refactor|perf|test|build|ci|chore
- Imperative mood (e.g., 'add', 'fix', 'update', not 'added', 'fixes')
- <72 chars total
- Describe THIS commit's changes, not entire branch or feature
- Be specific and atomic (like a changelog entry, not a summary)
- Focus on WHAT changed in this diff, not branch name or previous work" >>$temp_prompt
    
    if test -n "$ticket_number"
        echo "- Scope MUST be: AB#$ticket_number" >>$temp_prompt
    end
    
    echo "
EXAMPLES (atomic, specific commits):
- fix(AB#50147): prevent null pointer in user validation
- feat(AB#50147): add email field to registration form
- refactor(AB#50147): extract validation logic to helper function
- test(AB#50147): add edge case tests for empty input

OUTPUT: commit message only, no markdown/explanations

STAGED DIFF (focus on THIS change):
" >>$temp_prompt
    
    cat $temp_diff >>$temp_prompt
    
    # Run AI generation with fallback
    set temp_output (mktemp -t opencode_output.XXXXXX)
    set current_model $ai_model
    set session_id ""
    gum spin --spinner pulse --title "󰚩 Analyzing changes with $current_model..." -- sh -c "cat $temp_prompt | opencode run -m $current_model --format json > $temp_output 2>&1"
    
    set raw_output (cat $temp_output | sed 's/\x1b\[[0-9;]*m//g' | grep '^{' | jq -r 'select(.type == "text") | .part.text' 2>/dev/null | string trim)
    
    # Extract session ID for cleanup
    set session_id (cat $temp_output | sed 's/\x1b\[[0-9;]*m//g' | grep '^{' | jq -r 'select(.type == "session") | .sessionId' 2>/dev/null | head -n 1)
    
    # Try fallback model if primary failed
    if test -z "$raw_output"
        set current_model $fallback_model
        gum spin --spinner pulse --title "󰚩 Retrying with $current_model..." -- sh -c "cat $temp_prompt | opencode run -m $current_model --format json > $temp_output 2>&1"
        set raw_output (cat $temp_output | sed 's/\x1b\[[0-9;]*m//g' | grep '^{' | jq -r 'select(.type == "text") | .part.text' 2>/dev/null | string trim)
        
        # Update session ID if fallback was used
        if test -z "$session_id"
            set session_id (cat $temp_output | sed 's/\x1b\[[0-9;]*m//g' | grep '^{' | jq -r 'select(.type == "session") | .sessionId' 2>/dev/null | head -n 1)
        end
    end
    
    # Clean up session immediately after getting output
    if test -n "$session_id"
        opencode session delete "$session_id" >/dev/null 2>&1
    end
    
    rm -f $temp_prompt $temp_output $temp_diff
    
    if test -z "$raw_output"
        gum style " Failed to generate commit message"
        return 1
    end
    
    set commit_msg (string split \n $raw_output | string match -r '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\([^)]+\))?: .+' | head -n 1)
    if test -z "$commit_msg"
        set commit_msg (string split \n $raw_output | string match -r '\S+' | head -n 1)
    end
    if test -z "$commit_msg"
        gum style " Failed to extract valid commit message"
        return 1
    end
    
    set edited_msg (gum input --value "$commit_msg" --width 100 --prompt "󰏫 " --placeholder "Edit commit message or press Enter to accept...")
    if test $status -ne 0
        gum style --foreground 1 "󰜺 Commit cancelled"
        return 1
    end
    if test -z "$edited_msg"
        gum style --foreground 1 "󰜺 Commit cancelled (empty message)"
        return 1
    end
    
    # Add the commit command to shell history before executing
    # This allows easy re-run if pre-commit hooks fail
    history add git\ commit\ -m\ "$edited_msg" >/dev/null 2>&1
    git commit -m "$edited_msg"
    if test $status -eq 0
        gum style --foreground 2 "󰸞 Commit successful!"
        return 0
    else
        gum style --foreground 1 "󱎘 Commit failed"
        return 1
    end
end

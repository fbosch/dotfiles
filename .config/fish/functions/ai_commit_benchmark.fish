function ai_commit_benchmark --description 'Benchmark AI models for commit message generation'
    # Parse arguments for custom model list
    argparse 'a/all' -- $argv
    
    # Model candidates to test (fast models by default)
    set -l models
    if set -q _flag_all
        # Comprehensive test of all fast/small models
        set models \
            opencode/gpt-5-nano \
            github-copilot/gpt-4o \
            github-copilot/gpt-5-mini \
            github-copilot/gpt-5.1-codex-mini \
            github-copilot/claude-haiku-4.5 \
            anthropic/claude-haiku-4-5 \
            github-copilot/gemini-3-flash-preview \
            github-copilot/grok-code-fast-1
    else
        # Fast models only (default) - prioritizing "nano", "mini", and "fast" variants
        set models \
            opencode/gpt-5-nano \
            github-copilot/gpt-5-mini \
            github-copilot/claude-haiku-4.5 \
            github-copilot/gemini-3-flash-preview \
            github-copilot/grok-code-fast-1
    end
    
    # Check if we're in a git repo with staged changes
    if not git rev-parse --git-dir >/dev/null 2>&1
        gum style --foreground 1 " Not in a git repository"
        return 1
    end
    
    set -l staged_files (git diff --cached --name-only)
    if test -z "$staged_files"
        gum style --foreground 3 " No staged changes - creating a test commit scenario..."
        
        # Create a temporary test file to stage
        set -l test_file ".benchmark_test_$(date +%s).tmp"
        echo "test content for benchmarking" > $test_file
        git add $test_file
        
        set -l cleanup_needed true
    else
        set -l cleanup_needed false
    end
    
    if set -q _flag_all
        gum style --border rounded --padding "1 2" --foreground 6 "🏁 AI Commit Benchmark (All Fast Models)" \
            "" \
            "Testing models:" \
            "  • GPT-5 Nano" \
            "  • GPT-4o" \
            "  • GPT-5 Mini" \
            "  • GPT-5.1 Codex Mini" \
            "  • Claude Haiku 4.5 (GitHub)" \
            "  • Claude Haiku 4-5 (Anthropic)" \
            "  • Gemini 3 Flash" \
            "  • Grok Code Fast 1" \
            "" \
            "Metrics: Speed, Character Count, Format Compliance"
    else
        gum style --border rounded --padding "1 2" --foreground 6 "🏁 AI Commit Benchmark" \
            "" \
            "Testing models:" \
            "  • GPT-5 Nano" \
            "  • GPT-5 Mini" \
            "  • Claude Haiku 4.5" \
            "  • Gemini 3 Flash" \
            "  • Grok Code Fast 1" \
            "" \
            "Metrics: Speed, Character Count, Format Compliance"
    end
    
    echo ""
    
    # Capture sessions before benchmarking
    set -l sessions_before (opencode session list --format json -n 500 2>/dev/null | jq -r '.[].id' 2>/dev/null)
    
    # Results storage
    set -l results_file (mktemp -t ai_commit_benchmark.XXXXXX)
    printf "Model\tTime(s)\tMessage\tLength\tValid\n" > $results_file
    
    for model in $models
        set -l model_display (string replace 'github-copilot/' '' $model)
        gum style --foreground 6 "\n Testing $model_display..."
        
        # Measure time
        set -l start_time (date +%s%N)
        
        # Run ai_commit with dry-run and model override
        # Capture the commit message from the function
        set -l temp_output (mktemp -t model_output.XXXXXX)
        
        # We need to extract the generated message before user input
        # Let's create a modified version that outputs the AI result
        set -l temp_diff (mktemp -t commit_diff.XXXXXX)
        git diff --cached > $temp_diff
        
        # Build prompt (simplified from ai_commit)
        set -l branch_name (git rev-parse --abbrev-ref HEAD)
        set -l temp_prompt (mktemp -t opencode_prompt.XXXXXX)
        
        set -l skill_file "$HOME/.config/opencode/skills/ai-commit/SKILL.md"
        if not test -f "$skill_file"
            set skill_file "$HOME/dotfiles/.agents/skills/ai-commit/SKILL.md"
        end
        
        if not test -f "$skill_file"
            gum style --foreground 1 " Skill file not found"
            rm -f $temp_diff $temp_prompt $temp_output
            continue
        end
        
        # Extract skill body
        set -l skill_body (sed '1,/^---$/d' "$skill_file" | sed '1,/^---$/d')
        
        echo "🚨 CRITICAL: OUTPUT MUST BE EXACTLY ≤50 CHARACTERS TOTAL 🚨

Generate a Commitizen commit message for staged changes.

ABSOLUTE REQUIREMENTS:
1. Maximum 50 characters TOTAL (count: type + scope + colon + space + subject)
2. Format: <type>(<scope>): <subject>
3. Output ONLY the commit message - NO explanations, NO markdown, NO thinking
4. If >50 chars, you MUST abbreviate until ≤50

CONTEXT:
Branch: $branch_name

$skill_body

STAGED DIFF (focus on THIS change):
" > $temp_prompt
        
        cat $temp_diff >> $temp_prompt
        
        # Run OpenCode with timing
        cat $temp_prompt | opencode run -m $model --format json 2>/dev/null > $temp_output
        
        set -l end_time (date +%s%N)
        set -l elapsed_ns (math "$end_time - $start_time")
        # Convert to seconds with 2 decimal places
        set -l elapsed_s (printf "%.2f" (math "$elapsed_ns / 1000000000"))
        
        # Extract commit message
        set -l commit_msg (cat $temp_output | sed 's/\x1b\[[0-9;]*m//g' | jq -r 'select(.type == "text") | .part.text' 2>/dev/null | tail -n 1 | string trim)
        
        # Clean up and extract valid message
        set -l cleaned_msg (echo "$commit_msg" | sed 's/```[a-z]*//g' | sed 's/^[[:space:]]*//g' | string collect)
        set -l final_msg ""
        
        for line in (echo "$cleaned_msg" | string split "\n")
            if test -z "$line"
                continue
            end
            if string match -qr '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\([^)]+\))?: ' -- "$line"
                set final_msg "$line"
                break
            end
        end
        
        if test -z "$final_msg"
            set final_msg (echo "$cleaned_msg" | string split "\n" | string match -r '^\S.*' | head -n 1)
        end
        
        # Calculate metrics
        set -l msg_length (string length -- "$final_msg")
        set -l is_valid "✓"
        
        if test -z "$final_msg"
            set is_valid "✗ (empty)"
            set msg_length 0
        else if test "$msg_length" -gt 50
            set is_valid "✗ (too long)"
        else if not string match -qr '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\([^)]+\))?: ' -- "$final_msg"
            set is_valid "✗ (invalid format)"
        end
        
        # Display results
        gum style --foreground 2 "  ⏱  Time: $elapsed_s"s
        gum style --foreground 5 "  📏 Length: $msg_length chars"
        gum style --foreground (test "$is_valid" = "✓"; and echo 2; or echo 1) "  $is_valid"
        
        if test -n "$final_msg"
            gum style --foreground 8 "  💬 \"$final_msg\""
        else
            gum style --foreground 1 "  💬 (no valid output)"
        end
        
        # Save to results file (using tab delimiter to avoid comma issues)
        printf "%s\t%s\t%s\t%s\t%s\n" "$model_display" "$elapsed_s" "$final_msg" "$msg_length" "$is_valid" >> $results_file
        
        # Cleanup
        rm -f $temp_diff $temp_prompt $temp_output
    end
    
    # Display summary table
    echo ""
    gum style --border rounded --padding "1 2" --foreground 6 "📊 Benchmark Results"
    echo ""
    
    # Display formatted table using tab delimiter
    column -t -s $'\t' < $results_file
    
    echo ""
    
    # Find fastest valid model
    set -l fastest_model (tail -n +2 $results_file | awk -F'\t' '$5 == "✓" {print $2"\t"$1}' | sort -n | head -n 1 | cut -f2)
    
    if test -n "$fastest_model"
        gum style --foreground 2 --bold "🏆 Fastest valid model: $fastest_model"
    end
    
    # Cleanup
    rm -f $results_file
    
    # Cleanup OpenCode sessions created during benchmark
    gum style --foreground 8 "\n🧹 Cleaning up sessions..."
    set -l sessions_after (opencode session list --format json -n 500 2>/dev/null | jq -r '.[].id' 2>/dev/null)
    set -l deleted_count 0
    for session in $sessions_after
        if not contains $session $sessions_before
            # Delete session directory
            set -l project_id (opencode session list --format json -n 500 2>/dev/null | jq -r ".[] | select(.id == \"$session\") | .projectId" 2>/dev/null)
            if test -n "$project_id"
                rm -rf "$HOME/.local/share/opencode/storage/session/$project_id/$session" 2>/dev/null
                set deleted_count (math $deleted_count + 1)
            end
        end
    end
    
    if test $deleted_count -gt 0
        gum style --foreground 2 "✓ Deleted $deleted_count benchmark session(s)"
    end
    
    # Clean up test file if created
    if test "$cleanup_needed" = true
        git reset HEAD .benchmark_test_*.tmp 2>/dev/null
        rm -f .benchmark_test_*.tmp
        gum style --foreground 8 "✓ Cleaned up test files"
    end
end

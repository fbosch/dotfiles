function __ai_pr_benchmark --description 'Benchmark AI models for PR description generation (quality-focused)'
    # Parse arguments for custom model list
    argparse 'a/all' -- $argv
    
    # Model candidates - prioritizing quality and accuracy over pure speed
    set -l models
    if set -q _flag_all
        # Comprehensive test including higher-tier models for quality comparison
        set models \
            github-copilot/claude-haiku-4.5 \
            github-copilot/claude-sonnet-4.5 \
            anthropic/claude-haiku-4-5 \
            anthropic/claude-sonnet-4-5 \
            github-copilot/gpt-4o \
            github-copilot/gpt-5-mini \
            github-copilot/gemini-3-flash-preview \
            github-copilot/gemini-3-pro-preview
    else
        # Balanced models (quality + cost-effective)
        set models \
            github-copilot/claude-haiku-4.5 \
            github-copilot/claude-sonnet-4.5 \
            github-copilot/gpt-4o \
            github-copilot/gpt-5-mini \
            github-copilot/gemini-3-flash-preview
    end
    
    # Check if we're in a git repo
    if not git rev-parse --git-dir >/dev/null 2>&1
        gum style --foreground 1 " Not in a git repository"
        return 1
    end
    
    # Check for main/master branch and current branch
    set -l branch_name (git rev-parse --abbrev-ref HEAD)
    set -l main_branch ""
    if git show-ref --verify --quiet refs/heads/main
        set main_branch main
    else if git show-ref --verify --quiet refs/heads/master
        set main_branch master
    else
        gum style --foreground 1 " Could not find main or master branch"
        return 1
    end
    
    if test "$branch_name" = "$main_branch"
        gum style --foreground 1 " Current branch is $main_branch, cannot compare against itself"
        return 1
    end
    
    # Check for differences
    set -l diff_stat (git diff $main_branch..HEAD --stat)
    if test -z "$diff_stat"
        gum style --foreground 1 " No differences found between $branch_name and $main_branch"
        return 1
    end
    
    if set -q _flag_all
        gum style --border rounded --padding "1 2" --foreground 6 "🏁 AI PR Benchmark (Quality Focus - All Models)" \
            "" \
            "Testing models (prioritizing quality over speed):" \
            "  • Claude Haiku 4.5 (GitHub)" \
            "  • Claude Sonnet 4.5 (GitHub) - Higher quality" \
            "  • Claude Haiku 4-5 (Anthropic)" \
            "  • Claude Sonnet 4-5 (Anthropic) - Higher quality" \
            "  • GPT-4o" \
            "  • GPT-5 Mini" \
            "  • Gemini 3 Flash" \
            "  • Gemini 3 Pro - Higher quality" \
            "" \
            "Metrics: Output Quality > Speed, Format Compliance, Cost Efficiency"
    else
        gum style --border rounded --padding "1 2" --foreground 6 "🏁 AI PR Benchmark (Quality Focus)" \
            "" \
            "Testing balanced models (quality + cost):" \
            "  • Claude Haiku 4.5 (fast, good quality)" \
            "  • Claude Sonnet 4.5 (slower, best quality)" \
            "  • GPT-4o (balanced)" \
            "  • GPT-5 Mini (fast)" \
            "  • Gemini 3 Flash (fastest)" \
            "" \
            "Metrics: Output Quality > Speed, Format Compliance"
    end
    
    echo ""
    
    # Capture sessions before benchmarking
    set -l sessions_before (opencode session list --format json -n 500 2>/dev/null | jq -r '.[].id' 2>/dev/null)
    
    # Results storage
    set -l results_file (mktemp -t ai_pr_benchmark.XXXXXX)
    printf "Model\tQuality\tTime(s)\tLines\tValid\tTitle\tSummary\tChanges\n" > $results_file
    
    # Get PR context (reused for all models)
    set -l changed_files (git diff --name-only $main_branch..HEAD)
    set -l commit_messages (git log $main_branch..HEAD --pretty=format:"%s" --no-merges)
    set -l temp_diff (mktemp -t pr_diff.XXXXXX)
    git diff $main_branch..HEAD > $temp_diff
    set -l diff_line_count (wc -l <$temp_diff | string trim)
    
    # Build prompt once (shared across all models)
    set -l ticket_number ""
    if string match -qr '(\d+)' $branch_name
        set ticket_number (string match -r '\d+' $branch_name)
    end
    
    set -l branch_hint ""
    if string match -qr '^([a-z]+)/' $branch_name
        set branch_hint (string match -r '^([a-z]+)/' $branch_name | string split '/')[1]
    end
    
    set -l commitizen_type "chore"
    switch $branch_hint
        case feat feature
            set commitizen_type "feat"
        case fix bugfix
            set commitizen_type "fix"
        case docs doc
            set commitizen_type "docs"
        case refactor
            set commitizen_type "refactor"
    end
    
    set -l skill_file "$HOME/.config/opencode/skills/ai-pr/SKILL.md"
    if not test -f "$skill_file"
        gum style --foreground 1 " Skill not found: $skill_file"
        rm -f $temp_diff $results_file
        return 1
    end
    
    set -l skill_body (sed '1,/^---$/d' "$skill_file" | sed '1,/^---$/d')
    
    for model in $models
        set -l model_display (string replace 'github-copilot/' '' $model | string replace 'anthropic/' '' | string replace 'opencode/' '')
        echo ""
        gum style --foreground 6 "Testing $model_display..."
        echo ""
        
        # Measure time
        set -l start_time (date +%s%N)
        
        # Build prompt
        set -l temp_prompt (mktemp -t pr_prompt.XXXXXX)
        set -l temp_output (mktemp -t pr_output.XXXXXX)
        
        echo "Generate PR description in English (markdown) for branch '$branch_name' vs '$main_branch'.

Section headings:
- Summary: ## Summary
- Changes: ## Changes
- Testing: ## Testing
- Breaking: ## Breaking Changes

Title format:
$commitizen_type(#$ticket_number): Brief description (max 60 chars after colon, present tense)

Hard limits:
- Summary: 1 sentence, max 14 words
- Changes: 2-5 bullets, max 10 words each
- Testing: 1 bullet, command or \"Not stated\"
- Breaking: 1 bullet, \"None\" unless obvious in diff
- Total output: 26 lines max

Branch: $branch_name | Base: $main_branch | Files: "(string join ', ' $changed_files)"
Commits: "(string join ' | ' $commit_messages)"

$skill_body

CRITICAL: Your entire response must be ONLY the PR content. The first character you output must be the first character of the PR title.

Format:
Line 1: $commitizen_type(#$ticket_number): description (max 72 chars)
Line 2: blank
Line 3+: Markdown PR body" > $temp_prompt
        
        cat $temp_diff >> $temp_prompt
        
        # Run OpenCode with timing
        cat $temp_prompt | opencode run -m $model --format json 2>/dev/null > $temp_output
        
        set -l end_time (date +%s%N)
        set -l elapsed_ns (math "$end_time - $start_time")
        # Convert to seconds with 2 decimal places
        set -l elapsed_s (printf "%.2f" (math "$elapsed_ns / 1000000000"))
        
        # Extract PR description - concatenate all text parts
        set -l temp_pr_output (mktemp -t pr_text.XXXXXX)
        cat $temp_output | sed 's/\x1b\[[0-9;]*m//g' | grep '^{' | jq -r 'select(.type == "text") | .part.text' 2>/dev/null > $temp_pr_output
        
        # Read the output preserving newlines
        set -l pr_output (cat $temp_pr_output)
        
        # Analyze output
        set -l line_count (cat $temp_pr_output | wc -l | string trim)
        set -l has_title "✗"
        set -l has_summary "✗"
        set -l has_changes "✗"
        set -l is_valid "✗"
        set -l quality_score 0
        
        if test -s "$temp_pr_output"
            # Check for title (first line with commitizen format) - read directly from file
            set -l first_line (head -n 1 $temp_pr_output | string trim)
            
            # Match against the first element if it's an array
            if test -n "$first_line[1]"; and string match -qr '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\([^)]+\))?: ' -- "$first_line[1]"
                set has_title "✓"
                set quality_score (math $quality_score + 30)
            end
            
            # Check for Summary section
            if cat $temp_pr_output | string match -qr '## Summary'
                set has_summary "✓"
                set quality_score (math $quality_score + 25)
            end
            
            # Check for Changes section with bullets
            if cat $temp_pr_output | string match -qr '## Changes'
                set has_changes "✓"
                set quality_score (math $quality_score + 25)
                
                # Bonus: Check if changes has bullet points
                if cat $temp_pr_output | grep -A 10 '## Changes' | string match -qr '^- '
                    set quality_score (math $quality_score + 10)
                end
            end
            
            # Check for Testing section
            if cat $temp_pr_output | string match -qr '## Testing'
                set quality_score (math $quality_score + 5)
            end
            
            # Check for Breaking Changes section
            if cat $temp_pr_output | string match -qr '## Breaking'
                set quality_score (math $quality_score + 5)
            end
            
            # Valid if has all required components
            if test "$has_title" = "✓" -a "$has_summary" = "✓" -a "$has_changes" = "✓"
                set is_valid "✓"
            end
        end
        
        # Quality rating
        set -l quality_rating "Poor"
        if test $quality_score -ge 80
            set quality_rating "Excellent"
        else if test $quality_score -ge 60
            set quality_rating "Good"
        else if test $quality_score -ge 40
            set quality_rating "Fair"
        end
        
        # Display results
        gum style --foreground 2 "  ⏱  Time: $elapsed_s"s
        gum style --foreground 5 "  📄 Lines: $line_count"
        gum style --foreground 6 "  ⭐ Quality: $quality_rating ($quality_score/100)"
        gum style --foreground (test "$is_valid" = "✓"; and echo 2; or echo 1) "  $is_valid (Title: $has_title, Summary: $has_summary, Changes: $has_changes)"
        
        # Show preview of output using gum format for markdown rendering
        if test -s "$temp_pr_output"
            echo ""
            gum style --foreground 8 "  📄 Preview:"
            echo ""
            # Use gum format to render markdown nicely
            cat $temp_pr_output | head -n 10 | gum format --type markdown --theme dark | sed 's/^/    /'
            if test $line_count -gt 10
                echo ""
                gum style --foreground 8 "    ... ($line_count total lines)"
            end
            echo ""
        else
            gum style --foreground 1 "  ⚠  No output generated"
        end
        
        # Save to results file (using tab delimiter) - Quality first!
        printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" "$model_display" "$quality_rating" "$elapsed_s" "$line_count" "$is_valid" "$has_title" "$has_summary" "$has_changes" >> $results_file
        
        # Cleanup
        rm -f $temp_prompt $temp_output $temp_pr_output
    end
    
    # Display summary table
    echo ""
    gum style --border rounded --padding "1 2" --foreground 6 "📊 Benchmark Results"
    echo ""
    
    # Display formatted table using tab delimiter
    # Fish doesn't support $'\t', so we use printf to create a tab character
    column -t -s (printf '\t') < $results_file
    
    echo ""
    
    # Find best model - prioritize quality over speed
    # Look for "Excellent" quality first, then "Good", then fastest valid
    set -l best_model ""
    set -l best_excellent (tail -n +2 $results_file | awk -F'\t' '$2 == "Excellent" && $5 == "✓" {print $3"\t"$1}' | sort -n | head -n 1 | cut -f2)
    set -l best_good (tail -n +2 $results_file | awk -F'\t' '$2 == "Good" && $5 == "✓" {print $3"\t"$1}' | sort -n | head -n 1 | cut -f2)
    set -l fastest_valid (tail -n +2 $results_file | awk -F'\t' '$5 == "✓" {print $3"\t"$1}' | sort -n | head -n 1 | cut -f2)
    
    if test -n "$best_excellent"
        gum style --foreground 2 --bold "🏆 Best model (Excellent quality): $best_excellent"
    else if test -n "$best_good"
        gum style --foreground 2 --bold "🏆 Best model (Good quality): $best_good"
    else if test -n "$fastest_valid"
        gum style --foreground 3 --bold "⚠️  Best available (Fair quality): $fastest_valid"
    end
    
    # Also show fastest if different from best
    if test -n "$fastest_valid" -a "$fastest_valid" != "$best_excellent" -a "$fastest_valid" != "$best_good"
        gum style --foreground 6 "⚡ Fastest valid model: $fastest_valid"
    end
    
    # Cleanup
    rm -f $results_file $temp_diff
    
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
end

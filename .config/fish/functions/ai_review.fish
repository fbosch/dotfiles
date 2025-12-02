function ai_review --description 'Generate actionable code review feedback for current changes'
    set -l ai_model opencode/grok-code
    
    # Track temp files for cleanup
    set -l temp_files_to_cleanup
    
    if not git rev-parse --git-dir >/dev/null 2>&1
        gum style " Not in a git repository"
        return 1
    end
    set branch_name (git rev-parse --abbrev-ref HEAD 2>/dev/null)
    if test -z "$branch_name"
        gum style --foreground 1 " Failed to get current branch"
        return 1
    end
    
    # Priority: staged > unstaged > unpushed commits > feature branch vs main
    set diff_stat ""
    set diff_type ""
    set diff_base ""
    set commit_messages ""
    set changed_files ""
    
    # 1. Check for staged changes
    set diff_stat (git diff --cached --stat)
    if test -n "$diff_stat"
        set diff_type "staged changes"
        set changed_files (git diff --cached --name-only)
        set temp_diff (mktemp -t review_diff.XXXXXX)
        set -a temp_files_to_cleanup $temp_diff
        git diff --cached >$temp_diff
    # 2. Check for unstaged changes
    else
        set diff_stat (git diff --stat)
        if test -n "$diff_stat"
            set diff_type "unstaged changes"
            set changed_files (git diff --name-only)
            set temp_diff (mktemp -t review_diff.XXXXXX)
            git diff >$temp_diff
        # 3. Check for unpushed commits (compare to remote tracking branch)
        else
            set remote_branch (git rev-parse --abbrev-ref --symbolic-full-name @{upstream} 2>/dev/null)
            if test -n "$remote_branch"
                set diff_stat (git diff $remote_branch..HEAD --stat)
                if test -n "$diff_stat"
                    set diff_type "unpushed commits"
                    set diff_base $remote_branch
                    set changed_files (git diff --name-only $remote_branch..HEAD)
                    set commit_messages (git log $remote_branch..HEAD --pretty=format:"%s" --no-merges)
                    set temp_diff (mktemp -t review_diff.XXXXXX)
                    git diff $remote_branch..HEAD >$temp_diff
                end
            end
            
            # 4. Fallback: compare feature branch against main/master
            if test -z "$diff_stat"
                set main_branch ""
                if git show-ref --verify --quiet refs/heads/main
                    set main_branch main
                else if git show-ref --verify --quiet refs/heads/master
                    set main_branch master
                end
                
                if test -n "$main_branch" -a "$branch_name" != "$main_branch"
                    set diff_stat (git diff $main_branch..HEAD --stat)
                    if test -n "$diff_stat"
                        set diff_type "branch changes vs $main_branch"
                        set diff_base $main_branch
                        set changed_files (git diff --name-only $main_branch..HEAD)
                        set commit_messages (git log $main_branch..HEAD --pretty=format:"%s" --no-merges)
                        set temp_diff (mktemp -t review_diff.XXXXXX)
                        git diff $main_branch..HEAD >$temp_diff
                    end
                end
            end
        end
    end
    
    if test -z "$diff_stat"
        gum style " No changes to review"
        gum style --foreground 8 "  Tried: staged, unstaged, unpushed commits, branch vs main"
        return 1
    end
    
    set diff_line_count (wc -l <$temp_diff | string trim)
    set actual_diff_file $temp_diff
    if test $diff_line_count -gt 3000
        set actual_diff_file (mktemp -t review_diff_summary.XXXXXX)
        echo "$diff_stat" >$actual_diff_file
        echo "" >>$actual_diff_file
        echo "(Diff is very large. Showing file changes overview and partial diff for context.)" >>$actual_diff_file
        head -n 1000 $temp_diff >>$actual_diff_file
        echo "" >>$actual_diff_file
        echo "... (diff truncated at 1000 lines out of $diff_line_count total) ..." >>$actual_diff_file
    end
    set changed_files_list (string join ', ' $changed_files)
    set commits_list ""
    if test -n "$commit_messages"
        set commits_list (string join ' | ' $commit_messages)
    end
    
    # Build prompt without using variables in multiline strings to avoid shell expansion issues
    set temp_prompt_file (mktemp -t ai_review_prompt.XXXXXX)
    echo "Review code changes and provide actionable feedback.

Branch: $branch_name
Type: $diff_type
Files: $changed_files_list" >$temp_prompt_file
    
    if test -n "$commits_list"
        echo "Commits: $commits_list" >>$temp_prompt_file
    end
    
    echo "
FOCUS AREAS:
1. Logic & Correctness: bugs, edge cases, error handling, race conditions
2. Security: vulnerabilities, input validation, sensitive data exposure
3. Performance: inefficiencies, memory leaks, unnecessary computations
4. Code Quality: readability, maintainability, design patterns, DRY violations
5. Testing: missing test coverage, test quality, edge case coverage
6. Documentation: missing/outdated docs, unclear code comments

RULES:
- Be specific: reference file names, line patterns, or function names
- Be actionable: suggest concrete improvements, not vague observations
- Prioritize: critical issues first, then improvements, then nitpicks
- Skip trivial: ignore whitespace, formatting, style-only changes unless critical
- Be constructive: explain WHY something is an issue and HOW to fix it
- Use plain technical language, no fluff

OUTPUT FORMAT (markdown with line breaks after EACH item):

# Code Review

## Critical Issues
(Issues that must be fixed before merge)

- [File/Function]: Issue description + suggested fix
- [File/Function]: Another issue

## Improvements
(Important but not blocking)

- [File/Function]: Suggestion + rationale
- [File/Function]: Another suggestion

## Minor Notes
(Nice-to-haves, optional)

- [File/Function]: Observation + optional suggestion

## Positive Observations
(What was done well)

- Good practice observed
- Another positive observation

IMPORTANT: Put each bullet point on its OWN LINE. Add a blank line between sections. Use proper markdown formatting with line breaks.

Diff below. Provide specific, actionable feedback. Skip empty sections if no issues found.
" >>$temp_prompt_file
    
    set prompt (cat $temp_prompt_file)
    rm -f $temp_prompt_file
    set temp_prompt (mktemp -t opencode_prompt.XXXXXX)
    set temp_output (mktemp -t opencode_output.XXXXXX)
    set temp_review (mktemp -t review_output.XXXXXX.md)
    
    echo "$prompt" >$temp_prompt
    cat $actual_diff_file >>$temp_prompt
    gum spin --spinner pulse --title "󰚩 Analyzing changes with $ai_model..." -- sh -c "cat $temp_prompt | opencode run -m \"$ai_model\" --format json > $temp_output 2>&1"
    
    # Extract text from JSON output and write directly to file to preserve newlines
    # jq -r outputs raw strings with newlines preserved, automatically unescaping \n sequences
    # Write directly to file to avoid any shell variable processing that might affect newlines
    cat $temp_output | sed 's/\x1b\[[0-9;]*m//g' | grep '^{"type":"text"' | jq -r '.part.text' 2>/dev/null >$temp_review
    
    # Validate we got a response (check if file has content)
    if not test -s "$temp_review"
        gum style --foreground 1 " Failed to generate review feedback"
        rm -f $temp_prompt $temp_output $temp_review
        if test "$actual_diff_file" != "$temp_diff"
            rm -f $actual_diff_file
        end
        rm -f $temp_diff
        return 1
    end
    
    rm -f $temp_prompt $temp_output
    if test "$actual_diff_file" != "$temp_diff"
        rm -f $actual_diff_file
    end
    rm -f $temp_diff
    
    set clipboard_cmd ""
    if test (uname) = Darwin
        set clipboard_cmd pbcopy
    else if test (uname) = Linux
        if command -v wl-copy >/dev/null 2>&1
            set clipboard_cmd wl-copy
        else if command -v xclip >/dev/null 2>&1
            set clipboard_cmd "xclip -selection clipboard"
        end
    end
    
    if test -n "$clipboard_cmd"
        cat $temp_review | eval $clipboard_cmd
        if test $status -eq 0
            gum style --foreground 2 "󰸞 Review feedback copied to clipboard!"
        else
            gum style --foreground 1 "󱎘 Failed to copy to clipboard"
        end
    else
        gum style --foreground 3 "󰦨 Clipboard command not found"
    end
    echo ""
    if command -v glow >/dev/null 2>&1
        # Use glow with word wrapping disabled for better formatting
        glow -s dark -w 0 $temp_review
    else if command -v bat >/dev/null 2>&1
        bat --language markdown --style=plain --paging=never $temp_review
    else
        cat $temp_review
    end
    rm -f $temp_review
    _cleanup_last_opencode_session
end

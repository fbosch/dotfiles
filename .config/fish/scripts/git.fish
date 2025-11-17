# Git-related Fish functions

function worktree_add
    if not test -d .bare
        echo (set_color yellow)"Warning: Cannot create worktree outside a bare Git repository root. Aborting! ⚠️"(set_color normal)
        return 1
    end
    set branch_name $argv[1]

    set remote_branch_exists (git ls-remote --exit-code --heads origin $branch_name; echo $status)

    if test $remote_branch_exists -eq 0
        git worktree add $branch_name $branch_name
    else
        git worktree add -b $branch_name $branch_name
    end

    cd $branch_name
    swpm install
    git reset --hard HEAD
    echo (pwd) >>/tmp/.recent-worktrees
    echo (set_color green)"Worktree created and dependencies installed ✅"(set_color normal)
end

function latest_worktree
    echo (tail -n 1 /tmp/.recent-worktrees)
end

function worktrees_clean --description "Remove stale git worktrees (>7d) and their local branches"
    set -l worktrees (fd -t d --min-depth 2 --max-depth 2 --changed-before 7d)
    set -l total (count $worktrees)
    if test $total -eq 0
        echo "No old worktrees found (>7d)."
        return 0
    end
    set -l i 0
    set -l protected_branches main master develop release
    for wt in $worktrees
        if not test -f "$wt/.git"
            continue
        end
        if not string match -rq '^gitdir:' (head -n1 "$wt/.git")
            continue
        end
        set -l branch (git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null)
        set i (math $i + 1)
        set -l pct (math "100.0 * $i / $total")
        printf "Removing old worktrees: %.2f%%\r" $pct
        git worktree remove "$wt" 2>/dev/null
        or begin
            continue
        end
        if test "$branch" != "" -a "$branch" != HEAD
            if git show-ref --verify --quiet "refs/heads/$branch"
                if not contains -- $branch $protected_branches
                    git branch -D "$branch" 2>/dev/null
                end
            end
        end
        if test -d "$wt"
            rm -rf "$wt"
        end
    end
    printf "\n"
    git worktree prune
end

function git_add_gum
    if test -z "$files"
        echo (set_color --bold --background=yellow black)"[NOTICE] No changes to stage."(set_color normal)
        return
    end
    set selected (printf "%s\n" $files | gum choose --no-limit --header="   Select files to stage")
    git add $selected
end

# AI-powered Commitizen commit message
function ai_commit --description "Generate AI-powered Commitizen commit message from branch context"
    set -l ai_model opencode/grok-code
    if not git rev-parse --git-dir >/dev/null 2>&1
        gum style " Not in a git repository"
        return 1
    end
    set -l staged_files (git diff --cached --name-only)
    if test -z "$staged_files"
        gum style " No staged changes to commit"
        return 1
    end
    set branch_name (git rev-parse --abbrev-ref HEAD)
    set ticket_number ""
    if string match -qr '(\d+)' $branch_name
        set ticket_number (string match -r '\d+' $branch_name)
    end
    set branch_hint ""
    if string match -qr '^([a-z]+)/' $branch_name
        set branch_hint (string match -r '^([a-z]+)/' $branch_name | string split '/')[1]
    end
    set prompt "Generate Commitizen commit: type(scope): description
Types: feat|fix|docs|style|refactor|perf|test|build|ci|chore
Rules: imperative mood, <72 chars, concise, use ACTUAL changes not branch name
Branch: $branch_name"
    if test -n "$branch_hint"
        set prompt "$prompt (hint: $branch_hint)"
    end
    if test -n "$ticket_number"
        set prompt "$prompt\nScope MUST be: AB#$ticket_number"
    end
    set prompt "$prompt\n\nOutput: commit message only, no markdown/explanations\nExample: fix(AB#50147): resolve memory leak in data processor"
    set temp_prompt (mktemp -t opencode_prompt.XXXXXX)
    set temp_output (mktemp -t opencode_output.XXXXXX)
    echo "$prompt" > $temp_prompt
    gum spin --spinner pulse --title "󰚩 Analyzing changes with $ai_model..." -- sh -c "opencode run -m $ai_model --format json \"$(cat $temp_prompt)\" > $temp_output 2>&1"
    set raw_output (cat $temp_output | sed 's/\x1b\[[0-9;]*m//g' | grep '^{' | jq -r 'select(.type == "text") | .part.text' 2>/dev/null | string trim)
    rm -f $temp_prompt $temp_output
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
    git commit -m "$edited_msg"
    if test $status -eq 0
        gum style --foreground 2 "󰸞 Commit successful!"
    else
        gum style --foreground 1 "󱎘 Commit failed"
        return 1
    end
end

# AI-powered PR description
function ai_pr --description "Generate AI-powered PR description comparing current branch against main"
    set -l ai_model opencode/grok-code
    set -l language "en"
    if set -q argv[1]
        set language $argv[1]
    end
    if test "$language" != "en" -a "$language" != "dk"
        gum style --foreground 1 "Invalid language option: $language"
        gum style "Usage: ai_pr [en|dk]"
        return 1
    end
    set -l language_name "English"
    if test "$language" = "dk"
        set language_name "Danish"
    end
    if not git rev-parse --git-dir >/dev/null 2>&1
        gum style " Not in a git repository"
        return 1
    end
    set branch_name (git rev-parse --abbrev-ref HEAD)
    set main_branch ""
    if git show-ref --verify --quiet refs/heads/main
        set main_branch main
    else if git show-ref --verify --quiet refs/heads/master
        set main_branch master
    else
        gum style " Could not find main or master branch"
        return 1
    end
    if test "$branch_name" = "$main_branch"
        gum style " Current branch is $main_branch, cannot compare against itself"
        return 1
    end
    set diff_stat (git diff $main_branch..HEAD --stat)
    if test -z "$diff_stat"
        gum style " No differences found between $branch_name and $main_branch"
        return 1
    end
    set changed_files (git diff --name-only $main_branch..HEAD)
    set commit_messages (git log $main_branch..HEAD --pretty=format:"%s" --no-merges)
    set temp_diff (mktemp -t pr_diff.XXXXXX)
    git diff $main_branch..HEAD >$temp_diff
    set diff_line_count (wc -l <$temp_diff | string trim)
    set actual_diff_file $temp_diff
    if test $diff_line_count -gt 2000
        set actual_diff_file (mktemp -t pr_diff_summary.XXXXXX)
        git diff $main_branch..HEAD --stat >$actual_diff_file
        echo "" >>$actual_diff_file
        echo "(Diff is too large to include in full. Showing file changes only. Focus on the commit messages and file list above for context.)" >>$actual_diff_file
        git diff $main_branch..HEAD | head -n 500 >>$actual_diff_file
        echo "" >>$actual_diff_file
        echo "... (diff truncated, $diff_line_count total lines) ..." >>$actual_diff_file
    end
    set ticket_number ""
    if string match -qr '(\d+)' $branch_name
        set ticket_number (string match -r '\d+' $branch_name)
    end
    set branch_hint ""
    if string match -qr '^([a-z]+)/' $branch_name
        set branch_hint (string match -r '^([a-z]+)/' $branch_name | string split '/')[1]
    end
    set section_summary "## Summary"
    set section_changes "## Changes"
    set section_testing "## Testing"
    set section_breaking "## Breaking Changes"
    if test "$language" = "dk"
        set section_summary "## Resumé"
        set section_changes "## Ændringer"
        set section_testing "## Test"
        set section_breaking "## Breaking Changes"
    end
    set prompt "Generate PR description in $language_name (markdown) for branch '$branch_name' vs '$main_branch'.

CRITICAL - OMIT TRIVIAL CHANGES:
- If diff shows ONLY: trailing whitespace removal, commented code deletion, whitespace-only, formatting-only, empty lines, import reordering (non-functional), style-only → OMIT file entirely from PR description
- Do NOT list these as changes. Skip files that only have trivial changes.

INCLUDE ONLY:
- Functional code changes, bug fixes that change behavior, new features, API/config changes, tests, significant docs

RULES:
- Plain technical language (no marketing: avoid \"enhanced\", \"optimized\", \"robust\", etc.)
- Simple verbs: added/removed/changed/fixed/updated
- For fixes: what was broken + how fixed
- For changes: what changed from/to + why
- Prefer lists, use backticks for `files`/`functions`/`APIs`, blank lines between sections

STRUCTURE:
$section_summary
1-2 sentence overview.

$section_changes
Lists only. Only substantive changes visible in diff. Skip files with only trivial changes.

$section_testing
Lists only. How tested, manual steps, coverage.

$section_breaking
ONLY if breaking changes in diff. Omit entirely if none.

Branch: $branch_name | Base: $main_branch | Files: "(string join ', ' $changed_files)"
Commits: "(string join ' | ' $commit_messages)"

Diff below. Describe ONLY visible substantive changes. Skip trivial changes entirely."
    if test -n "$branch_hint"
        set prompt "$prompt\nBranch type: $branch_hint"
    end
    set prompt "$prompt\n\nOutput: Markdown PR description in $language_name. All text in $language_name. No explanations."
    set temp_prompt (mktemp -t opencode_prompt.XXXXXX)
    set temp_output (mktemp -t opencode_output.XXXXXX)
    echo "$prompt" >$temp_prompt
    cat $actual_diff_file >>$temp_prompt
    gum spin --spinner pulse --title "󰚩 Analyzing changes with $ai_model..." -- sh -c "opencode run -m $ai_model --format json \"$(cat $temp_prompt)\" > $temp_output 2>&1"
    set pr_desc (cat $temp_output | sed 's/\x1b\[[0-9;]*m//g' | grep '^{' | jq -r 'select(.type == "text") | .part.text' 2>/dev/null | string trim)
    rm -f $temp_prompt $temp_output $temp_diff
    if test -z "$pr_desc"
        gum style --foreground 1 " Failed to generate PR description"
        return 1
    end
    set edited_content (gum input --value "$pr_desc" --width 100 --prompt "󰏫 " --placeholder "Edit PR description or press Enter to accept...")
    if test $status -ne 0
        gum style --foreground 1 "󰜺 PR description cancelled"
        return 1
    end
    if test -z "$edited_content"
        gum style --foreground 1 "󰜺 PR description cancelled (empty content)"
        return 1
    end
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
        echo -n "$edited_content" | eval $clipboard_cmd
        if test $status -eq 0
            gum style --foreground 2 "󰸞 PR description copied to clipboard!"
        else
            gum style --foreground 1 "󱎘 Failed to copy to clipboard"
        end
    else
        gum style --foreground 3 "󰦨 Clipboard command not found, displaying content:"
        echo "$edited_content"
    end
end
# AI-powered code review feedback
function ai_review --description "Generate actionable code review feedback for current changes"
    set -l ai_model opencode/grok-code
    if not git rev-parse --git-dir >/dev/null 2>&1
        gum style " Not in a git repository"
        return 1
    end
    set branch_name (git rev-parse --abbrev-ref HEAD)
    
    # Check for staged changes first, then uncommitted changes
    set diff_stat (git diff --cached --stat)
    set diff_type "staged"
    if test -z "$diff_stat"
        set diff_stat (git diff --stat)
        set diff_type "unstaged"
    end
    
    if test -z "$diff_stat"
        gum style " No changes to review (nothing staged or modified)"
        return 1
    end
    
    set changed_files (git diff --cached --name-only)
    if test "$diff_type" = "unstaged"
        set changed_files (git diff --name-only)
    end
    
    set temp_diff (mktemp -t review_diff.XXXXXX)
    if test "$diff_type" = "staged"
        git diff --cached >$temp_diff
    else
        git diff >$temp_diff
    end
    
    set diff_line_count (wc -l <$temp_diff | string trim)
    set actual_diff_file $temp_diff
    if test $diff_line_count -gt 3000
        set actual_diff_file (mktemp -t review_diff_summary.XXXXXX)
        if test "$diff_type" = "staged"
            git diff --cached --stat >$actual_diff_file
        else
            git diff --stat >$actual_diff_file
        end
        echo "" >>$actual_diff_file
        echo "(Diff is very large. Showing file changes overview and partial diff for context.)" >>$actual_diff_file
        head -n 1000 $temp_diff >>$actual_diff_file
        echo "" >>$actual_diff_file
        echo "... (diff truncated at 1000 lines out of $diff_line_count total) ..." >>$actual_diff_file
    end
    set prompt "Review code changes ($diff_type) and provide actionable feedback.

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

OUTPUT FORMAT (markdown with proper line breaks):
# Code Review

Branch: $branch_name
Changes: $diff_type
Files: "(string join ', ' $changed_files)"

## Critical Issues
(Issues that must be fixed before merge)

- [File/Function]: Issue description + suggested fix

## Improvements
(Important but not blocking)

- [File/Function]: Suggestion + rationale

## Minor Notes
(Nice-to-haves, optional)

- [File/Function]: Observation + optional suggestion

## Positive Observations
(What was done well)

- Good practice observed

Diff below. Provide specific, actionable feedback. Skip empty sections if no issues found."
    set temp_prompt (mktemp -t opencode_prompt.XXXXXX)
    set temp_output (mktemp -t opencode_output.XXXXXX)
    echo "$prompt" >$temp_prompt
    cat $actual_diff_file >>$temp_prompt
    gum spin --spinner pulse --title "󰚩 Analyzing changes with $ai_model..." -- sh -c "opencode run -m $ai_model --format json \"$(cat $temp_prompt)\" > $temp_output 2>&1"
    set temp_feedback (mktemp -t review_feedback.XXXXXX)
    # Extract JSON text parts, strip all ANSI codes, and replace literal [0m with newlines to restore formatting
    cat $temp_output | sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' | grep '^{' | jq -r 'select(.type == "text") | .part.text' 2>/dev/null | sed -E 's/\[0m */\n/g; s/\[[0-9;]+m//g' >$temp_feedback
    set review_feedback (cat $temp_feedback)
    rm -f $temp_feedback
    rm -f $temp_prompt $temp_output
    if test "$actual_diff_file" != "$temp_diff"
        rm -f $actual_diff_file
    end
    rm -f $temp_diff
    if test -z "$review_feedback"
        gum style --foreground 1 " Failed to generate review feedback"
        return 1
    end
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
    set temp_review (mktemp -t review_output.XXXXXX.md)
    echo "$review_feedback" >$temp_review
    
    # Clean up ANSI codes: first strip ESC sequences, then convert spaces after them to newlines
    set temp_clean (mktemp -t review_clean.XXXXXX.md)
    sed -E 's/\x1b\[[0-9;]*[mK]//g' $temp_review | sed -E 's/  +/\n/g' >$temp_clean
    mv $temp_clean $temp_review
    
    # Debug: save to a persistent location for inspection
    set debug_file "/tmp/ai_review_last.md"
    cp $temp_review $debug_file
    
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
    gum style --foreground 8 "Debug: Raw output saved to $debug_file"
    echo ""
    if command -v glow >/dev/null 2>&1
        glow -s dark $temp_review
    else if command -v bat >/dev/null 2>&1
        bat --language markdown --style=plain --paging=never $temp_review
    else
        cat $temp_review
    end
    rm -f $temp_review
end

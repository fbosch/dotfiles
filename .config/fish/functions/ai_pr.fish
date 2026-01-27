function ai_pr --description 'Generate AI-powered PR description comparing current branch against main'
    set -l ai_model github-copilot/claude-haiku-4.5
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
     # Map branch hint to commitizen category
     set commitizen_type "chore"
     switch $branch_hint
         case feat feature
             set commitizen_type "feat"
         case fix bugfix
             set commitizen_type "fix"
         case docs doc
             set commitizen_type "docs"
         case style
             set commitizen_type "style"
         case refactor
             set commitizen_type "refactor"
         case perf performance
             set commitizen_type "perf"
         case test tests
             set commitizen_type "test"
         case ci
             set commitizen_type "ci"
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
    set skill_file "$HOME/.config/opencode/skills/ai-pr/SKILL.md"
    if not test -f "$skill_file"
        gum style --foreground 1 " Skill not found: $skill_file"
        rm -f "$temp_diff" "$actual_diff_file"
        return 1
    end
    set skill_body (sed '1,/^---$/d' "$skill_file" | sed '1,/^---$/d')
    set prompt "Generate PR description in $language_name (markdown) for branch '$branch_name' vs '$main_branch'.

Section headings:
- Summary: $section_summary
- Changes: $section_changes
- Testing: $section_testing
- Breaking: $section_breaking

Title format:
$commitizen_type(#$ticket_number): Brief description (max 60 chars after colon, present tense)

Hard limits:
- Summary: 1 sentence, max 14 words
- Changes: 2-5 bullets, max 10 words each
- Testing: 1 bullet, command or \"Not stated\"
- Breaking: 1 bullet, \"None\" unless obvious in diff
- Total output: 26 lines max

Length calibration:
- Small PR (<=3 files and <=2 commits): 2 bullets
- Medium PR (4-10 files or 3-6 commits): 3-4 bullets
- Large PR (>10 files or >6 commits): 4-5 bullets

Minimum content:
- Always include Summary and Changes
- Changes must include at least 2 bullets

Branch: $branch_name | Base: $main_branch | Files: "(string join ', ' $changed_files)"
Commits: "(string join ' | ' $commit_messages)"

$skill_body

Diff below. Describe ONLY visible substantive changes. Skip trivial changes entirely."
    if test -n "$branch_hint"
        set prompt "$prompt\nBranch type: $branch_hint"
    end
    set prompt "$prompt\n\nCRITICAL: Your entire response must be ONLY the PR content. The first character you output must be the first character of the PR title. Do not output any thoughts, explanations, analysis, or intent. Do not add any preface such as 'Intent:' or 'Here is'.\n\nFormat:\nLine 1: $commitizen_type(#$ticket_number): description (max 72 chars)\nLine 2: blank\nLine 3+: Markdown PR body in $language_name\n\nIf you cannot meet limits, shorten further."
    set temp_prompt (mktemp -t opencode_prompt.XXXXXX)
    set temp_output (mktemp -t opencode_output.XXXXXX)
    echo "$prompt" >$temp_prompt
    cat $actual_diff_file >>$temp_prompt
    set temp_pr_desc (mktemp).md
    
    # Run opencode by piping the prompt instead of command substitution
    set opencode_exit_code 0
    gum spin --spinner pulse --title "󰚩 Analyzing changes with $ai_model..." -- sh -c "cat $temp_prompt | opencode run -m $ai_model --format json > $temp_output 2>&1"
    or set opencode_exit_code $status
    
    # Check if opencode failed
    if test $opencode_exit_code -ne 0
        gum style --foreground 1 " OpenCode command failed (exit $opencode_exit_code)"
        if test -s "$temp_output"
            echo "Output:"
            cat $temp_output
        end
        rm -f "$temp_pr_desc" $temp_prompt $temp_output $temp_diff
        return 1
    end
    
    # Check if output file has content
    if not test -s "$temp_output"
        gum style --foreground 1 " OpenCode produced no output"
        rm -f "$temp_pr_desc" $temp_prompt $temp_output $temp_diff
        return 1
    end
    
    # Extract the text from JSON response and write directly to file to preserve newlines
    # jq -r outputs raw strings with newlines preserved, automatically unescaping \n sequences
    # Write directly to file to avoid any shell variable processing that might affect newlines
    cat $temp_output | sed 's/\x1b\[[0-9;]*m//g' | grep '^{' | jq -r 'select(.type == "text") | .part.text' >$temp_pr_desc 2>$temp_output.err
    
    # Validate we got a response (check if file has content)
    if not test -s "$temp_pr_desc"
        # Check for errors
        if test -s "$temp_output.err"
            gum style --foreground 1 " JSON parsing error:"
            cat "$temp_output.err"
        else
            gum style --foreground 1 " No JSON output found. Raw response:"
            cat $temp_output | head -n 50
        end
        rm -f "$temp_pr_desc" "$temp_output.err" $temp_prompt $temp_output $temp_diff
        return 1
    end
    
    rm -f $temp_prompt $temp_output $temp_diff "$temp_output.err"
    
    # Open in ephemeral Neovim instance for editing
    # -f: foreground (blocking)
    # --cmd: commands before loading config (runs before user config)
    # -c: commands to run after loading config
    # Session persistence is automatically disabled when opening a specific file (argc > 0)
    # Combine settings to minimize command count
    nvim -f \
        --cmd "set noswapfile nobackup nowritebackup" \
        -c "set filetype=markdown wrap linebreak spell textwidth=0 wrapmargin=0 nolist conceallevel=0" \
        -c "set formatoptions-=t formatoptions+=l" \
        -c "autocmd VimLeavePre * silent! write" \
        -c "set statusline=%f\ %=[PR\ Description\ -\ exit\ to\ copy\ to\ clipboard] | normal! gg" \
        "$temp_pr_desc"
    
    # Check if file still exists (user might have deleted it or cancelled)
    if not test -f "$temp_pr_desc"
        gum style --foreground 1 "󰜺 PR description cancelled"
        return 1
    end
    
    # Validate file has content (user didn't clear it completely)
    if not test -s "$temp_pr_desc"
        rm -f "$temp_pr_desc"
        gum style --foreground 1 "󰜺 PR description cancelled (empty content)"
        return 1
    end
    
    # Copy to clipboard directly from file to preserve formatting and newlines
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
        # Copy directly from file, stripping any ANSI codes
        sed 's/\x1b\[[0-9;]*m//g' "$temp_pr_desc" | eval $clipboard_cmd
        if test $status -eq 0
            gum style --foreground 2 "󰸞 PR description copied to clipboard!"
        else
            gum style --foreground 1 "󱎘 Failed to copy to clipboard"
        end
    else
        gum style --foreground 3 "󰦨 Clipboard command not found, displaying content:"
        cat "$temp_pr_desc"
    end
    
    # Cleanup temp file
    rm -f "$temp_pr_desc"
end

function ai_pr --description 'Generate AI-powered PR description comparing current branch against main'
    argparse 'm/model=' -- $argv
    or return 1
    
    set -l ai_model (set -q _flag_model; and echo $_flag_model; or echo github-copilot/claude-haiku-4.5)

    if not git rev-parse --git-dir >/dev/null 2>&1
        gum style " Not in a git repository"
        return 1
    end

    set -l branch_name (git rev-parse --abbrev-ref HEAD)
    set -l main_branch ""
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

    set -l diff_stat (git diff $main_branch..HEAD --stat)
    if test -z "$diff_stat"
        gum style " No differences found between $branch_name and $main_branch"
        return 1
    end

    # Generate diff with truncation for large PRs
    set -l temp_diff (mktemp -t pr_diff.XXXXXX)
    git diff $main_branch..HEAD >$temp_diff
    set -l diff_line_count (wc -l <$temp_diff | string trim)
    
    set -l actual_diff_file $temp_diff
    if test $diff_line_count -gt 2000
        set actual_diff_file (mktemp -t pr_diff_summary.XXXXXX)
        git diff $main_branch..HEAD --stat >$actual_diff_file
        echo "" >>$actual_diff_file
        echo "(Diff is too large to include in full. Showing file changes only. Focus on the commit messages and file list above for context.)" >>$actual_diff_file
        git diff $main_branch..HEAD | head -n 500 >>$actual_diff_file
        echo "" >>$actual_diff_file
        echo "... (diff truncated, $diff_line_count total lines) ..." >>$actual_diff_file
        rm -f $temp_diff
    end

    set -l temp_pr_desc (mktemp).md
    set -l temp_output (mktemp -t opencode_output.XXXXXX)
    
    # Run opencode with diff file passed as argument content
    set -l diff_content (cat $actual_diff_file)
    gum spin --spinner pulse --title "󰚩 Analyzing changes with $ai_model..." -- \
        sh -c "opencode run --command ai-pr -m $ai_model --format json '$diff_content' > $temp_output 2>&1"
    set -l opencode_exit_code $status
    
    rm -f $actual_diff_file
    
    if test $opencode_exit_code -ne 0
        gum style --foreground 1 " OpenCode command failed (exit $opencode_exit_code)"
        if test -s "$temp_output"
            echo "Output:"
            cat $temp_output
        end
        rm -f "$temp_pr_desc" $temp_output
        return 1
    end
    
    if not test -s "$temp_output"
        gum style --foreground 1 " OpenCode produced no output"
        rm -f "$temp_pr_desc" $temp_output
        return 1
    end
    
    # Extract text from JSON response, write to file
    cat $temp_output | sed 's/\x1b\[[0-9;]*m//g' | grep '^{' | jq -r 'select(.type == "text") | .part.text' >$temp_pr_desc 2>/dev/null
    
    if not test -s "$temp_pr_desc"
        gum style --foreground 1 " No valid PR description generated. Raw output:"
        cat $temp_output | head -n 50
        rm -f "$temp_pr_desc" $temp_output
        return 1
    end
    
    rm -f $temp_output

    # Open in Neovim for editing
    nvim -f \
        --cmd "set noswapfile nobackup nowritebackup" \
        -c "set filetype=markdown wrap linebreak spell textwidth=0 wrapmargin=0 nolist conceallevel=0" \
        -c "set formatoptions-=t formatoptions+=l" \
        -c "autocmd VimLeavePre * silent! write" \
        -c "set statusline=%f\ %=[PR\ Description\ -\ exit\ to\ copy\ to\ clipboard] | normal! gg" \
        "$temp_pr_desc"
    
    if not test -f "$temp_pr_desc"
        gum style --foreground 1 "󰜺 PR description cancelled"
        return 1
    end

    if not test -s "$temp_pr_desc"
        rm -f "$temp_pr_desc"
        gum style --foreground 1 "󰜺 PR description cancelled (empty content)"
        return 1
    end
    
    # Copy to clipboard
    set -l clipboard_cmd ""
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

    rm -f "$temp_pr_desc"
end

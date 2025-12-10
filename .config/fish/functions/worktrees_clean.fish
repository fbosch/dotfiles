function worktrees_clean --description 'Remove stale git worktrees (>7d) and their local branches'
    # Verify we're in a git repository
    if not git rev-parse --git-dir &>/dev/null
        gum style --foreground 196 "Error: Not in a git repository"
        return 1
    end

    # Find worktrees older than 7 days
    set -l worktrees (fd -t d --min-depth 2 --max-depth 2 --changed-before 7d 2>/dev/null)
    set -l total (count $worktrees)
    
    if test $total -eq 0
        gum style --foreground 243 "No old worktrees found (>7 days)."
        return 0
    end

    # Protected branches that should never be deleted
    set -l protected_branches main master develop release

    # Filter valid worktrees
    set -l valid_worktrees
    for wt in $worktrees
        # Check if .git file exists (worktrees have a .git file, not a directory)
        if not test -f "$wt/.git"
            continue
        end
        # Verify it's a valid worktree by checking gitdir reference
        if not string match -rq '^gitdir:' (head -n1 "$wt/.git" 2>/dev/null)
            continue
        end
        set -a valid_worktrees "$wt"
    end

    set -l valid_total (count $valid_worktrees)
    if test $valid_total -eq 0
        gum style --foreground 243 "No valid worktrees to clean."
        return 0
    end

    # Confirm with user
    gum confirm "Found $valid_total stale worktree(s). Remove them?"
    or return 0

    # Process worktrees with progress tracking
    set -l removed_count 0
    set -l skipped_count 0
    set -l current 0
    set -l skipped_items  # Array to track skipped worktrees
    
    # Detect if we can use Nerd Fonts
    set -l use_nerd_fonts true
    if test "$TERM" = "linux"; or test "$TERM" = "dumb"
        set use_nerd_fonts false
    else if not string match -q "*UTF*" "$LANG$LC_ALL"
        set use_nerd_fonts false
    end
    
    # Set symbols based on environment
    if test "$use_nerd_fonts" = "true"
        set -l check_symbol ""    # U+F00C nf-fa-check
        set -l warn_symbol ""     # U+F071 nf-fa-warning
    else
        set -l check_symbol "+"
        set -l warn_symbol "!"
    end

    echo
    gum style --foreground 212 "Cleaning $valid_total worktrees..."
    echo

    # Initialize progress bar
    progress_bar --init

    for wt in $valid_worktrees
        set current (math $current + 1)
        
        # Get branch name before removal
        set -l branch (git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null)
        set -l wt_name (basename "$wt")
        
        # Build stats string for progress bar (using appropriate symbols)
        if test "$use_nerd_fonts" = "true"
            set -l stats_str "$removed_count $skipped_count"
        else
            set -l stats_str "$removed_count✓ $skipped_count✗"
        end
        
        # Show progress with current item being processed BEFORE processing
        progress_bar --current $current --total $valid_total --label "Cleaning" --name "$wt_name" --stats "$stats_str"
        
        # Small delay to show the progress bar before processing
        sleep 0.05
        
        # Attempt to remove worktree
        if git worktree remove "$wt" 2>/dev/null
            set removed_count (math $removed_count + 1)
            
            # Clear progress bar and print output with appropriate symbol
            printf '\r' >&2
            tput el 2>/dev/null >&2
            echo >&2  # Move to new line
            gum style --foreground 35 "$check_symbol Removed: $wt_name"
            
            # Remove associated local branch if it exists and is not protected
            if test "$branch" != "" -a "$branch" != HEAD
                if git show-ref --verify --quiet "refs/heads/$branch"
                    if not contains -- $branch $protected_branches
                        if git branch -D "$branch" &>/dev/null
                            gum style --foreground 35 "  └─ Deleted branch: $branch"
                        end
                    else
                        gum style --foreground 214 "  └─ Protected branch kept: $branch"
                    end
                end
            end
            
            # Mark that we need a new progress bar line
            set -g __progress_bar_exists false
            
            # Update progress bar with new stats after output
            if test "$use_nerd_fonts" = "true"
                set -l stats_str "$removed_count $skipped_count"
            else
                set -l stats_str "$removed_count✓ $skipped_count✗"
            end
            progress_bar --current $current --total $valid_total --label "Cleaning" --name "$wt_name" --stats "$stats_str"
        else
            set skipped_count (math $skipped_count + 1)
            set -a skipped_items "$wt_name"  # Track skipped item
            
            # Clear progress bar and print output with appropriate symbol
            printf '\r' >&2
            tput el 2>/dev/null >&2
            echo >&2  # Move to new line
            gum style --foreground 214 "$warn_symbol Skipped: $wt_name (uncommitted changes or in use)"
            
            # Mark that we need a new progress bar line
            set -g __progress_bar_exists false
            
            # Update progress bar with new stats after output
            if test "$use_nerd_fonts" = "true"
                set -l stats_str "$removed_count $skipped_count"
            else
                set -l stats_str "$removed_count✓ $skipped_count✗"
            end
            progress_bar --current $current --total $valid_total --label "Cleaning" --name "$wt_name" --stats "$stats_str"
        end

        # Cleanup directory if it still exists
        if test -d "$wt"
            rm -rf "$wt" 2>/dev/null
        end
    end
    
    # Finish progress bar (restore cursor and print newline)
    progress_bar --finish

    # Final cleanup
    git worktree prune 2>/dev/null

    # Summary
    echo
    set -l summary_lines "Summary:" "  Removed: $removed_count" "  Skipped: $skipped_count" "  Total processed: $valid_total"
    
    # Add list of skipped worktrees if any
    if test $skipped_count -gt 0
        set -a summary_lines "" "Skipped worktrees:"
        for item in $skipped_items
            set -a summary_lines "  • $item"
        end
    end
    
    gum style --border rounded --padding "0 1" --foreground 212 $summary_lines
end

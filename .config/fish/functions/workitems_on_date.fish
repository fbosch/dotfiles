function workitems_on_date --description 'Extract Azure DevOps work item numbers from branches on a specific date and copy to clipboard'
    if not git rev-parse --git-dir >/dev/null 2>&1
        gum style " Not in a git repository"
        return 1
    end

    # Parse the date using the flexible date parser (defaults to today if no arg provided)
    set -l target_date (parse_flexible_date $argv[1])
    
    # Check if parsing failed
    if test $status -ne 0
        gum style --foreground 1 " Invalid date format"
        gum style --foreground 8 "  Supported formats:"
        gum style --foreground 8 "    • DD.MM.YYYY (e.g., 20.12.2025)"
        gum style --foreground 8 "    • DD.MM (e.g., 20.12 - assumes current year)"
        gum style --foreground 8 "    • YYYY-MM-DD (e.g., 2025-12-20)"
        gum style --foreground 8 "    • Weekday name (e.g., monday, thursday)"
        return 1
    end
    
    # Get all branches
    set -l all_branches (git for-each-ref refs/heads/ --format='%(refname:short)')
    
    set -l workitem_numbers
    set -l found_branches
    
    for branch_name in $all_branches
        # Check if this branch has any commits on the target date
        set -l commits_on_date (git log $branch_name --since="$target_date 00:00:00" --until="$target_date 23:59:59" --pretty=format:"%H")
        
        # Skip if no commits on target date
        if test -z "$commits_on_date"
            continue
        end
        
        # Extract work item from branch name first
        set -l workitem ""
        if string match -qr 'AB#(\d+)' $branch_name
            set workitem (string match -r 'AB#(\d+)' $branch_name | tail -n 1)
        else if string match -qr '(\d+)' $branch_name
            set workitem (string match -r '\d+' $branch_name | head -n 1)
        end
        
        # Add work item from branch name if found
        if test -n "$workitem"
            if not contains $workitem $workitem_numbers
                set -a workitem_numbers $workitem
                set -a found_branches $branch_name
            end
        else
            # No work item in branch name, check commit messages
            set -l commit_msgs (git log $branch_name --since="$target_date 00:00:00" --until="$target_date 23:59:59" --pretty=format:"%s")
            
            for commit_msg in $commit_msgs
                if string match -qr 'AB#(\d+)' $commit_msg
                    set -l commit_workitems (string match -ar 'AB#(\d+)' $commit_msg)
                    set -l idx 1
                    for item in $commit_workitems
                        if test (math "$idx % 2") -eq 0
                            if not contains $item $workitem_numbers
                                set -a workitem_numbers $item
                                if not contains $branch_name $found_branches
                                    set -a found_branches $branch_name
                                end
                            end
                        end
                        set idx (math $idx + 1)
                    end
                end
            end
        end
    end
    
    if test (count $workitem_numbers) -eq 0
        set -l formatted_date (format_date_display $target_date)
        gum style --foreground 3 " No work items found in branches from $formatted_date"
        return 0
    end
    
    # Create comma-separated list with spaces for readability
    set -l workitem_list (string join ', ' $workitem_numbers)
    
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
    
    # Format date for display
    set -l formatted_date (format_date_display $target_date)
    
    if test -n "$clipboard_cmd"
        echo -n $workitem_list | eval $clipboard_cmd
        if test $status -eq 0
            gum style --foreground 2 "󰸞 Work items copied to clipboard: $workitem_list"
            echo ""
            gum style --foreground 8 "  Found in branches from $formatted_date:"
            for branch in $found_branches
                echo "    • $branch"
            end
        else
            gum style --foreground 1 "󱎘 Failed to copy to clipboard"
            echo "Work items: $workitem_list"
        end
    else
        gum style --foreground 3 "󰦨 Clipboard command not found"
        echo "Work items: $workitem_list"
    end
end

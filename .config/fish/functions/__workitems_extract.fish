function __workitems_extract --description 'Extract work items from git commits for given date range (internal helper)'
    # Arguments: start_date end_date
    # Returns: Lines of "date|workitem|branch" for each unique work item found
    
    set -l start_date $argv[1]
    set -l end_date $argv[2]
    
    # Cache directory for work items
    set -l cache_dir ~/.cache/fish/workitems
    mkdir -p $cache_dir
    
    # Get git repo root for cache key uniqueness
    set -l git_root (git rev-parse --show-toplevel 2>/dev/null)
    if test -z "$git_root"
        set git_root "unknown"
    end
    set -l repo_hash (echo -n $git_root | md5sum | cut -d' ' -f1 2>/dev/null; or echo -n $git_root | md5 2>/dev/null)
    
    # Get current git user email for author filtering
    set -l git_user_email (git config user.email)
    
    # Get today's date to determine if we can use cache
    set -l today (command date +%Y-%m-%d)
    
    # Check if we're querying only past dates (can be cached)
    # YYYY-MM-DD format allows lexicographic comparison using string match
    set -l can_cache 0
    # Sort the two dates and check if end_date comes first
    set -l sorted (printf "%s\n%s\n" "$end_date" "$today" | sort)
    if test "$sorted[1]" = "$end_date" -a "$end_date" != "$today"
        set can_cache 1
    end
    
    # Generate cache file name
    set -l cache_key "$repo_hash-$start_date-$end_date"
    set -l cache_file "$cache_dir/$cache_key"
    
    # Return cached results if available and query is for past dates
    if test $can_cache -eq 1 -a -f "$cache_file"
        cat "$cache_file"
        return 0
    end
    
    # Get all branches
    set -l all_branches (git for-each-ref refs/heads/ --format='%(refname)')
    
    # Get all commits for the date range with hash, date, and subject
    set -l commits_data (git log --all --author="$git_user_email" --no-merges --since="$start_date 00:00:00" --until="$end_date 23:59:59" --pretty=format:"%H|%as|%s" 2>/dev/null)
    
    # Build a map of commit hash -> branch names
    set -l commit_branches
    for branch_ref in $all_branches
        set -l branch_name (string replace 'refs/heads/' '' $branch_ref)
        set -l branch_commits (git log $branch_ref --author="$git_user_email" --no-merges --since="$start_date 00:00:00" --until="$end_date 23:59:59" --pretty=format:"%H" 2>/dev/null)
        for commit_hash in $branch_commits
            set -a commit_branches "$commit_hash:$branch_name"
        end
    end
    
    # Track which date|workitem|branch combos we've already output
    set -l output_items
    
    # Process commits
    for commit_line in $commits_data
        set -l parts (string split '|' $commit_line)
        set -l commit_hash $parts[1]
        set -l commit_date $parts[2]
        set -l commit_subject $parts[3]
        
        # Find which branch(es) this commit belongs to
        for mapping in $commit_branches
            if string match -q "$commit_hash:*" $mapping
                set -l branch_name (string split ':' $mapping)[2]
                
                # Extract work item from branch name
                set -l workitem ""
                if string match -qr 'AB#(\d+)' $branch_name
                    set workitem (string match -r 'AB#(\d+)' $branch_name | tail -n 1)
                else if string match -qr '(\d+)' $branch_name
                    set workitem (string match -r '\d+' $branch_name | head -n 1)
                    # Skip if it looks like a date format (8 digits)
                    if test (string length $workitem) -eq 8
                        set workitem ""
                    end
                end
                
                # Collect work item from branch name if found
                if test -n "$workitem"
                    set -l item_key "$commit_date|$workitem|$branch_name"
                    if not contains $item_key $output_items
                        set -a output_items $item_key
                    end
                end
            end
        end
        
        # Also check commit message for AB# references
        if string match -qr 'AB#(\d+)' $commit_subject
            set -l commit_workitems (string match -ar 'AB#(\d+)' $commit_subject)
            set -l idx 1
            for item in $commit_workitems
                if test (math "$idx % 2") -eq 0
                    # Skip if it looks like a date format (8 digits)
                    if test (string length $item) -ne 8
                        # Find the branch for this commit
                        for mapping in $commit_branches
                            if string match -q "$commit_hash:*" $mapping
                                set -l branch_name (string split ':' $mapping)[2]
                                set -l item_key "$commit_date|$item|$branch_name"
                                if not contains $item_key $output_items
                                    set -a output_items $item_key
                                end
                                break
                            end
                        end
                    end
                end
                set idx (math $idx + 1)
            end
        end
    end
    
    # Output results and cache if needed
    if test $can_cache -eq 1
        # Write to cache file and output
        for item in $output_items
            echo $item
        end > "$cache_file"
        # Output from cache to avoid duplicate loop
        cat "$cache_file"
    else
        # Just output (don't cache today's data as it may change)
        for item in $output_items
            echo $item
        end
    end
end

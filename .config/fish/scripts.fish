function worktree_add
    set branch_name $argv[1]
    
    set remote_branch_exists (git ls-remote --exit-code --heads origin $branch_name; echo $status)
    
    if test $remote_branch_exists -eq 0
        # Branch exists on remote, create directory without -b option
        git worktree add $branch_name $branch_name
    else
        # Branch doesn't exist on remote, create directory with -b option
        git worktree add -b $branch_name $branch_name
    end

    cd $branch_name
    swpm install
    git reset --hard HEAD
   
    echo "Worktree added and installed ✅"
end

function worktrees_clean 
  set old_worktrees (fd --type d --min-depth 2 --max-depth 2 --changed-before 7d)
  set total_folders (count $old_worktrees)
  set current_folder_index 0

  for folder in $old_worktrees 
    set current_folder_index (math $current_folder_index + 1)
    set progress_percent (math "100 * $current_folder_index / $total_folders")

    echo -n (printf "Removing old worktrees: %.2f%%\r" $progress_percent)
    rm -rf $subfolder
    git branch --merged | egrep -v "$subfolder" | xargs --no-run-if-empty git branch -d
  end
end

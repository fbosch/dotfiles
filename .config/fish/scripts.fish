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


function first_login_of_the_day
  set current_date (date "+%Y-%m-%d")
  # if _first_login starts with current date, return the cached time

  if test -n "$_first_login"
    set cached_date (string split ";" $_first_login)[1]
    if test $cached_date = $current_date
      set cached_time (string split ";" $_first_login)[2]
      echo $cached_time
      return
    end
  end

  set cached_time (cat /tmp/.first_login/$current_date^ 2> /dev/null)

  if test -n "$cached_time"
    # join the date and time global variable
    set -Ux _first_login "$current_date;$cached_time"

    echo $cached_time
    return 
  end
  set login_item (log show --style syslog --predicate 'process == "loginwindow"' --debug --info --last 8h | rg --max-count=1 "LUIAuthenticationServiceProvider deactivateWithContext:]_block_invoke")

  # extract the date from the log
  set date (echo $login_item | rg -o -N '\d{4}-\d{2}-\d{2}\b' )
  set time (echo $login_item | rg -o -N '\d{2}:\d{2}:\d{2}\b' )

  # cache the result
  mkdir -p /tmp/.first_login
  echo $time > /tmp/.first_login/$current_date

  set -Ux _first_login "$current_date;$time"

  echo $time
end
 
function hours_since_workday_start
  set current_hour (date "+%H")
  set current_minute (date "+%M")
  set workday_start_hour (string split ":" (first_login_of_the_day))[1]
  set workday_start_minute (string split ":" (first_login_of_the_day))[2]

  set total_minutes_since_start (math "($current_hour - $workday_start_hour) * 60 + $current_minute - $workday_start_minute")

  set value (math $total_minutes_since_start / 60)
  
  echo $value
    # echo $hours_since_start
end

function workday 
  set given_hour (first_login_of_the_day)
  set current_hour (date +%H)
  set current_minute (date +%M)

  # Extract the hour and minute from the given time
  set given_hour_hour (string split : $given_hour)[1]
  set given_hour_minute (string split : $given_hour)[2]

  # Remove leading zeros if present
  set given_hour_hour (string replace -r '^0' '' $given_hour_hour)
  set given_hour_minute (string replace -r '^0' '' $given_hour_minute)

  # Calculate the hours and minutes passed
  set hours_passed (math "$current_hour - $given_hour_hour")
  set minutes_passed (math "$current_minute - $given_hour_minute")

  # Adjust for negative minutes
  if test $minutes_passed -lt 0
      set minutes_passed (math "$minutes_passed + 60")
      set hours_passed (math "$hours_passed - 1")
  end

  # Determine the color and emoji based on the number of hours passed
  if test $hours_passed -gt 6
      set emoji "✅"    # Check mark
      set color (set_color green)    # Green
  else if test $hours_passed -gt 4
      set emoji "⌛"    # Hourglass
      set color (set_color yellow)    # Orange
  else
      set color (set_color red)    # Red
  end

  set reset_color (set_color normal)

  # Display the result with colored formatting
  if test $minutes_passed -eq 0
      echo -e "Work hours passed since $given_hour: \n$emoji $color$hours_passed hour(s)$reset_color"
  else
      echo -e "Work hours passed since $given_hour: \n$emoji $color$hours_passed hour(s) and $minutes_passed minutes$reset_color"
  end
end

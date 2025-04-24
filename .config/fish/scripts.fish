function wezterm_set_user_var
    if hash base64 2>/dev/null
        if test -z "$TMUX"
            printf "\033]1337;SetUserVar=%s=%s\007" "$argv[1]" (echo -n "$argv[2]" | base64)
        else
            # <https://github.com/tmux/tmux/wiki/FAQ#what-is-the-passthrough-escape-sequence-and-how-do-i-use-it>
            printf "\033Ptmux;\033\033]1337;SetUserVar=%s=%s\007\033\\" "$argv[1]" (echo -n "$argv[2]" | base64)
        end
    end
    commandline --function repaint
end

function worktree_add
    if not test -d .bare
        echo (set_color yellow)"Warning: Cannot create worktree outside a bare Git repository root. Aborting! ⚠️"(set_color normal)
        return 1
    end
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
    echo (pwd) >>/tmp/.recent-worktrees
    echo (set_color green)"Worktree created and dependencies installed ✅"(set_color normal)
end

function latest_worktree
    echo (tail -n 1 /tmp/.recent-worktrees)
end

function worktrees_clean
    set old_worktrees (fd --type d --min-depth 2 --max-depth 2 --changed-before 7d)
    set total_folders (count $old_worktrees)
    set current_folder_index 0

    for folder in $old_worktrees
        set current_folder_index (math $current_folder_index + 1)
        set progress_percent (math "100 * $current_folder_index / $total_folders")

        echo -n (printf "Removing old worktrees: %.2f%%\r" $progress_percent)

        # Get the branch name from the folder path
        set branch_name (basename "$folder")

        # First, remove the worktree
        git worktree remove "$folder" 2>/dev/null

        # Then try to delete the branch
        if git show-ref --verify --quiet "refs/heads/$branch_name"
            git branch -D "$branch_name" 2>/dev/null
        end

        # Remove the physical folder if it still exists
        if test -d "$folder"
            rm -rf "$folder"
        end
    end

    # Prune any stale worktree references
    git worktree prune
end

function first_login_of_the_day
    set -l silent 0
    if contains -- --silent $argv
        set silent 1
    end

    set -l current_date (date "+%y-%m-%d")
    set -l cache_file "/tmp/.first_login/$current_date"

    if test -f "$cache_file" && read -l cached_time <"$cache_file"
        wezterm_set_user_var first_login "$cached_time"
        if test $silent -eq 0
            echo "$cached_time"
        end
        return
    end

    set -l login_item (log show \
        --start (date '+%Y-%m-%d 07:30:00') \
        --predicate 'process == "loginwindow"' \
        | grep -i "success" \
        | head -n1)

    set -l time (string match -r '\d{2}:\d{2}:\d{2}\b' "$login_item")

    mkdir -p (dirname "$cache_file")
    echo "$time" >"$cache_file"
    wezterm_set_user_var first_login "$time"

    if test $silent -eq 0
        echo "$time"
    end
end

function fzfcd
    if test -d .git -a -f .git/HEAD
        # if current directory is a .bare git repository, search for child directories contains .git folders only
        set selected_dir (fd -tf --max-depth=4 --color=never "\.git\$" -H | rev | cut -c 6- | rev | fzf --preview "lt {}" --preview-window "25%")
    else
        set selected_dir (fd -td --max-depth=4 --color=never | fzf --preview "lt {}" --preview-window "25%")
    end
    if test -n "$selected_dir"
        z "$selected_dir" # Change directory if selection is not empty
        commandline --function repaint
    end
end

function toggle_proxy
    set current_status (networksetup -getwebproxy "Wi-Fi" | grep Enabled | cut -d " " -f 2 | head -1)
    if test "$current_status" = No
        echo (set_color green)" 🌐 Turning the proxy on "(set_color normal)
        networksetup -setwebproxystate Wi-Fi on
        networksetup -setsecurewebproxystate Wi-Fi on
    else
        echo (set_color red)" 🌐 Turning the proxy off "(set_color normal)
        networksetup -setwebproxystate Wi-Fi off
        networksetup -setsecurewebproxystate Wi-Fi off
    end
end

function proxy_status
    echo (set_color blue)" 🌐 Proxy status "(set_color normal)
    echo "HTTP: "
    networksetup -getwebproxy Wi-Fi | grep Enabled | cut -d " " -f 2 | head -1
    echo "HTTPS: "
    networksetup -getsecurewebproxy Wi-Fi | grep Enabled | cut -d " " -f 2 | head -1
end

function get_week_dates
    # Validate and set week number
    set -l week_number (date +%V)
    if set -q argv[1]
        and string match -r '^\d+$' -- "$argv[1]"
        set week_number $argv[1]
    end

    # Validate and set year
    set -l year (date +%Y)
    if set -q argv[2]
        and string match -r '^\d{4}$' -- "$argv[2]"
        set year $argv[2]
    end

    # BSD date week calculation function
    function _calculate_week_dates
        set -l input_year $argv[1]
        set -l input_week $argv[2]

        # Calculate the first Monday of the year
        set -l jan1 (date -j -f "%Y-%m-%d" "$input_year-01-01" +%s)
        set -l jan1_weekday (date -j -f "%Y-%m-%d" "$input_year-01-01" +%w)

        # Adjust to get to the first Monday
        set -l days_to_first_monday (math "1 - $jan1_weekday")
        if test $days_to_first_monday -ge 0
            set days_to_first_monday (math "$days_to_first_monday - 7")
        end

        # Calculate the start of the specified week
        set -l week_start_seconds (math "$jan1 + ($input_week - 1) * 7 * 86400 + $days_to_first_monday * 86400")
        set -l week_end_seconds (math "$week_start_seconds + 6 * 86400")

        # Convert timestamps to dates
        set --local start_date (date -j -f "%s" "$week_start_seconds" +"%d %B")
        set --local end_date (date -j -f "%s" "$week_end_seconds" +"%d %B")

        echo $start_date
        echo $end_date
    end

    # Calculate and set dates
    set -l dates (_calculate_week_dates $year $week_number)
    set -l start_date $dates[1]
    set -l end_date $dates[2]

    # Print results
    echo "Week $week_number ($year):"
    echo "Start date: $start_date"
    echo "End date: $end_date"
end

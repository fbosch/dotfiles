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
        # Ensure it looks like a git worktree (has .git file pointing to gitdir)
        if not test -f "$wt/.git"
            continue
        end
        if not string match -rq '^gitdir:' (head -n1 "$wt/.git")
            continue
        end

        # Resolve actual branch checked out in this worktree (may be 'HEAD' if detached)
        set -l branch (git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null)

        # Progress
        set i (math $i + 1)
        set -l pct (math "100.0 * $i / $total")
        printf "Removing old worktrees: %.2f%%\r" $pct

        # Remove worktree (clean only; add --force if you truly want to nuke dirty trees)
        git worktree remove "$wt" 2>/dev/null
        or begin
            # If removal failed because it’s checked out/dirty, skip branch deletion
            continue
        end

        # Delete local branch if:
        #  - it resolves to a real branch (not 'HEAD')
        #  - it exists in refs/heads
        #  - it’s not protected
        if test "$branch" != "" -a "$branch" != HEAD
            if git show-ref --verify --quiet "refs/heads/$branch"
                if not contains -- $branch $protected_branches
                    # Git refuses deleting a branch checked out in ANY worktree; -D still fails then.
                    git branch -D "$branch" 2>/dev/null
                end
            end
        end

        # Remove folder if still present (belt-and-suspenders)
        if test -d "$wt"
            rm -rf "$wt"
        end
    end

    printf "\n"
    git worktree prune
end

function mntnas
    if test (uname) = Darwin
        osascript -e 'mount volume "smb://100.86.100.78"'
        return 0
    end

    if test (uname) = Linux
        set share (gum input --placeholder="Shared Folder" --prompt="󰉌 ")
        if test -z "$share"
            echo "No share provided."
            return 1
        end
        set user (whoami)
        set mount_point /mnt/nas
        if not test -d $mount_point
            sudo mkdir -p $mount_point
        end
        set uid (id -u)
        set gid (id -g)
        sudo mount -t cifs "//192.168.1.2/$share" $mount_point -o user=$user,uid=$uid,gid=$gid
        cd /mnt/nas
    end

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

    set -l login_item (log show --start (date '+%Y-%m-%d 07:30:00') --predicate 'process == "loginwindow"' | grep -i "success" | head -n1)

    set -l time (string match -r '\d{2}:\d{2}:\d{2}\b' "$login_item")

    mkdir -p (dirname "$cache_file")
    echo "$time" >"$cache_file"
    wezterm_set_user_var first_login "$time"

    if test $silent -eq 0
        echo "$time"
    end
end

function workday_end
    set start (first_login_of_the_day)

    if test -z "$start" -o (string length "$start") -ne 8
        set start "08:15:00"
    end

    set today (date +'%Y-%m-%d')
    set start_ts (date -j -f "%Y-%m-%d %H:%M:%S" "$today $start" +"%s")

    set seconds_to_add 27000
    set end_ts (math "$start_ts + $seconds_to_add")

    date -r $end_ts +"%T"
end

function remaining_work_hours
    set -l first_login (first_login_of_the_day)

    if test -z "$first_login"
        echo "Error: No first login time"
        return 1
    end

    set -l current_time (date "+%H:%M")

    set -l work_end (workday_end)

    set -l current_hours (string split ":" "$current_time")[1]
    set -l current_minutes (string split ":" "$current_time")[2]
    set -l end_hours (string split ":" "$work_end")[1]
    set -l end_minutes (string split ":" "$work_end")[2]

    set -l remaining_hours (math $end_hours - $current_hours)
    set -l remaining_minutes (math $end_minutes - $current_minutes)

    if test $remaining_minutes -lt 0
        set remaining_hours (math $remaining_hours - 1)
        set remaining_minutes (math $remaining_minutes + 60)
    end

    if test $remaining_hours -gt 0
        printf "%d hours and %d minutes left\n" $remaining_hours $remaining_minutes
    else if test $remaining_minutes -gt 0
        printf "%d minutes left\n" $remaining_minutes
    else
        echo "Work day is over"
        return
    end

    printf "Workday ends at: %s\n" $work_end
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
        and test "$argv[1]" -ge 1
        and test "$argv[1]" -le 53
        set week_number $argv[1]
    else if set -q argv[1]
        echo "Error: Week number must be between 1 and 53"
        return 1
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

function disk_space
    df -h / | awk 'NR==2 {print "Total: " $2 "\nUsed: " $3 "\nAvailable: " $4 "\nPercentage Used: " $5}'
end

function git_add_gum
    if test -z "$files"
        echo (set_color --bold --background=yellow black)"[NOTICE] No changes to stage."(set_color normal)
        return
    end

    set selected (printf "%s\n" $files | gum choose --no-limit --header="   Select files to stage")
    git add $selected
end

function set_workday_start
    set -l time_input (gum input \
            --placeholder "HH:MM" \
            --prompt "󱫒 Started workday at: ")

    # Exit if user presses Ctrl+C or enters nothing
    if test -z "$time_input"
        return 1
    end

    set -l current_date (date "+%y-%m-%d")
    set -l cache_file "/tmp/.first_login/$current_date"

    # Validate input: must match 24-hour HH:MM
    if string match -rq '^(0?[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' -- $time_input
        set -g TIME_HOUR (string split ":" $time_input)[1]
        set -g TIME_MINUTE (string split ":" $time_input)[2]

        set -l start_time "$time_input:00"
        mkdir -p (dirname "$cache_file")
        echo "$start_time" >"$cache_file"
        wezterm_set_user_var first_login "$start_time"
        echo (set_color green)" Workday started at $TIME_HOUR:$TIME_MINUTE"(set_color normal)
        return 0
    else
        gum style \
            --border rounded --border-foreground 1 --margin "0 1" \
            "   Invalid time format "
    end
end

function export_npm_globals
    set old_file ~/dotfiles/npm-globals.json.bak
    set new_file ~/dotfiles/npm-globals.json

    if test -f $new_file
        mv $new_file $old_file
    end

    # Exclude 'npm' itself from export
    npm list -g --depth=0 --json | jq 'del(.dependencies.npm) | .dependencies | map_values(.version)' >$new_file

    if test -f $old_file
        echo "Diff (old vs new):"
        difft $old_file $new_file
    else
        echo "No previous npm-globals.json found, exported current global packages."
        cat $new_file
    end
end

function install_npm_globals
    set file ~/dotfiles/npm-globals.json
    if not test -f $file
        set_color red
        echo "✗ File $file does not exist."
        set_color normal
        return 1
    end

    set args (jq -r 'to_entries[] | "\(.key)@\(.value)"' $file)
    if test (count $args) -eq 0
        set_color yellow
        echo "  No packages found in $file."
        set_color normal
        return 1
    end

    set_color cyan
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo " 󰏗  Installing global npm packages:"
    set_color normal

    for pkg in $args
        set_color green
        echo "  • $pkg"
        set_color normal
    end

    set_color cyan
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    set_color normal

    npm install -g $args

    if test $status -eq 0
        set_color green
        echo "  All packages installed successfully."
    else
        set_color red
        echo "  Error installing one or more packages."
    end
    set_color normal
end

function ai_commit --description "Generate AI-powered Commitizen commit message from branch context"
    # Model configuration
    set -l ai_model "openai/gpt-4.1-mini"

    # Check if we're in a git repository
    if not git rev-parse --git-dir >/dev/null 2>&1
        gum style " Not in a git repository"
        return 1
    end

    # Check if there are staged changes
    set -l staged_files (git diff --cached --name-only)
    if test -z "$staged_files"
        gum style " No staged changes to commit"
        return 1
    end

    # Get current branch name
    set branch_name (git rev-parse --abbrev-ref HEAD)

    # Extract ticket number if present (supports formats like: fix/50147-desc, feat/AB-1234-desc, etc.)
    set ticket_number ""
    if string match -qr '(\d+)' $branch_name
        set ticket_number (string match -r '\d+' $branch_name)
    end

    # Extract branch prefix hint (fix/, feat/, docs/, etc.)
    set branch_hint ""
    if string match -qr '^([a-z]+)/' $branch_name
        set branch_hint (string match -r '^([a-z]+)/' $branch_name | string split '/')[1]
    end

    # Build context prompt for OpenCode
    set -l context_parts
    test -n "$branch_hint" && set -a context_parts "Branch prefix: $branch_hint"
    test -n "$ticket_number" && set -a context_parts "Ticket number: $ticket_number"

    set context_info (string join ", " $context_parts)
    test -n "$context_info" && set context_info " ($context_info)"

    # Create comprehensive prompt for OpenCode
    set prompt "Analyze the staged git changes and generate a Commitizen-compliant commit message.

REQUIREMENTS:
- Use Commitizen format: type(scope): description
- Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore
- Choose the type based on ACTUAL changes, not just branch name
- Keep description concise (max 72 chars for first line)
- Use imperative mood (\"add\" not \"added\")
- Do NOT include body or footer, just the one-line message

CONTEXT:$context_info
- Branch: $branch_name"

    # Add ticket reference instruction if ticket number found
    if test -n "$ticket_number"
        set prompt "$prompt
- MUST include ticket reference as scope: AB#$ticket_number
- Format: type(AB#$ticket_number): description"
    end

    set prompt "$prompt

OUTPUT FORMAT:
Return ONLY the commit message, nothing else. No markdown, no explanations.
Example: fix(AB#50147): resolve memory leak in data processor"

    # Run OpenCode with spinner and extract response
    set temp_prompt (mktemp -t opencode_prompt.XXXXXX)
    set temp_output (mktemp -t opencode_output.XXXXXX)

    # Write prompt to file to avoid escaping issues
    printf '%s' "$prompt" >$temp_prompt

    # Use gum spin to show loading indicator while AI is thinking
    # Pass prompt as positional arguments by reading from file
    gum spin --spinner dot --title " Analyzing changes with $ai_model..." -- sh -c "opencode run -m $ai_model --format json \$(cat $temp_prompt) > $temp_output 2>&1"

    # Extract the text from JSON response (strip ANSI codes, filter JSON, extract text)
    set commit_msg (cat $temp_output | sed 's/\x1b\[[0-9;]*m//g' | grep '^{' | jq -r 'select(.type == "text") | .part.text' 2>/dev/null | string trim)

    # Cleanup
    rm -f $temp_prompt $temp_output

    # Validate we got a response
    if test -z "$commit_msg"
        gum style " Failed to generate commit message"
        return 1
    end

    # Display the generated message using gum format for better presentation
    echo
    echo "# Generated Commit Message" | gum format
    echo
    gum style \
        \
        --border rounded \
        --border-foreground 110 \
        --padding "1 2" \
        --width 80 \
        "$commit_msg"
    echo

    # Display metadata
    gum style --italic " Generated by $ai_model"
    echo

    # Prompt user for confirmation using gum
    if gum confirm --default --affirmative="Commit" --negative="Cancel" "Proceed with this commit?"
        git commit -m "$commit_msg"
        if test $status -eq 0
            gum style " Commit successful!"
        else
            gum style " Commit failed"
            return 1
        end
    else
        gum style " Commit cancelled"
        return 1
    end
end

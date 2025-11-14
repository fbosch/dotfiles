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
    # set -l ai_model github-copilot/claude-haiku-4.5
    set -l ai_model opencode/grok-code

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

    # Build compressed prompt for faster inference (OpenCode will analyze full diff automatically)
    set prompt "Generate Commitizen commit: type(scope): description
Types: feat|fix|docs|style|refactor|perf|test|build|ci|chore
Rules: imperative mood, <72 chars, concise, use ACTUAL changes not branch name
Branch: $branch_name"

    # Add context hints if available
    test -n "$branch_hint" && set prompt "$prompt (hint: $branch_hint)"

    # Add ticket reference instruction if ticket number found
    if test -n "$ticket_number"
        set prompt "$prompt
Scope MUST be: AB#$ticket_number"
    end

    set prompt "$prompt

Output: commit message only, no markdown/explanations
Example: fix(AB#50147): resolve memory leak in data processor"

    # Run OpenCode with spinner and extract response
    set temp_prompt (mktemp -t opencode_prompt.XXXXXX)
    set temp_output (mktemp -t opencode_output.XXXXXX)

    # Write prompt to file to avoid escaping issues
    printf '%s' "$prompt" >$temp_prompt

    # Use gum spin to show loading indicator while AI is thinking
    gum spin --spinner pulse --title "󰚩 Analyzing changes with $ai_model..." -- sh -c "opencode run -m $ai_model --format json \$(cat $temp_prompt) > $temp_output 2>&1"

    # Extract the text from JSON response (strip ANSI codes, filter JSON, extract text)
    set raw_output (cat $temp_output | sed 's/\x1b\[[0-9;]*m//g' | grep '^{' | jq -r 'select(.type == "text") | .part.text' 2>/dev/null | string trim)

    # Cleanup temp files
    rm -f $temp_prompt $temp_output

    # Validate we got a response
    if test -z "$raw_output"
        gum style " Failed to generate commit message"
        return 1
    end

    # Extract only the commit message line (first line matching Commitizen format)
    # Matches: type(scope): description OR type: description
    set commit_msg (string split \n $raw_output | string match -r '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\([^)]+\))?: .+' | head -n 1)

    # Fallback: if no Commitizen format found, take first non-empty line
    if test -z "$commit_msg"
        set commit_msg (string split \n $raw_output | string match -r '\S+' | head -n 1)
    end

    # Final validation
    if test -z "$commit_msg"
        gum style " Failed to extract valid commit message"
        return 1
    end

    # Allow user to edit the commit message with prefilled value
    set edited_msg (gum input --value "$commit_msg" --width 100 --prompt "󰏫 " --placeholder "Edit commit message or press Enter to accept...")

    # Check if user cancelled (Ctrl+C) or provided empty input
    if test $status -ne 0
        gum style --foreground 1 "󰜺 Commit cancelled"
        return 1
    end

    # If user cleared the message completely, cancel
    if test -z "$edited_msg"
        gum style --foreground 1 "󰜺 Commit cancelled (empty message)"
        return 1
    end

    # Commit with the edited message
    git commit -m "$edited_msg"
    if test $status -eq 0
        gum style --foreground 2 "󰸞 Commit successful!"
    else
        gum style --foreground 1 "󱎘 Commit failed"
        return 1
    end
end

function ai_pr --description "Generate AI-powered PR description comparing current branch against main"
    # Model configuration
    set -l ai_model opencode/grok-code

    # Parse language argument (default: English)
    set -l language "en"
    if set -q argv[1]
        set language $argv[1]
    end

    # Validate language option
    if test "$language" != "en" -a "$language" != "dk"
        gum style --foreground 1 "Invalid language option: $language"
        gum style "Usage: ai_pr [en|dk]"
        gum style "  en - English (default)"
        gum style "  dk - Danish"
        return 1
    end

    # Set language name for prompt
    set -l language_name "English"
    if test "$language" = "dk"
        set language_name "Danish"
    end

    # Check if we're in a git repository
    if not git rev-parse --git-dir >/dev/null 2>&1
        gum style " Not in a git repository"
        return 1
    end

    # Get current branch name
    set branch_name (git rev-parse --abbrev-ref HEAD)

    # Determine main branch (try main first, then master)
    set main_branch ""
    if git show-ref --verify --quiet refs/heads/main
        set main_branch main
    else if git show-ref --verify --quiet refs/heads/master
        set main_branch master
    else
        gum style " Could not find main or master branch"
        return 1
    end

    # Check if current branch is already main/master
    if test "$branch_name" = "$main_branch"
        gum style " Current branch is $main_branch, cannot compare against itself"
        return 1
    end

    # Check if there are any differences
    set diff_stat (git diff $main_branch..HEAD --stat)
    if test -z "$diff_stat"
        gum style " No differences found between $branch_name and $main_branch"
        return 1
    end

    # Get list of changed files
    set changed_files (git diff --name-only $main_branch..HEAD)

    # Get commit messages from the branch
    set commit_messages (git log $main_branch..HEAD --pretty=format:"%s" --no-merges)

    # Get the actual diff content - write to temp file to avoid shell variable size limits
    set temp_diff (mktemp -t pr_diff.XXXXXX)
    git diff $main_branch..HEAD >$temp_diff
    
    # Check diff size and limit if needed
    set diff_line_count (wc -l <$temp_diff | string trim)
    set actual_diff_file $temp_diff
    
    # If diff is too large, create a summary version
    # Use more conservative limit to avoid OpenCode token/argument limits
    if test $diff_line_count -gt 2000
        set actual_diff_file (mktemp -t pr_diff_summary.XXXXXX)
        git diff $main_branch..HEAD --stat >$actual_diff_file
        echo "" >>$actual_diff_file
        echo "(Diff is too large to include in full. Showing file changes only. Focus on the commit messages and file list above for context.)" >>$actual_diff_file
        # Include first 500 lines for context (more conservative)
        git diff $main_branch..HEAD | head -n 500 >>$actual_diff_file
        echo "" >>$actual_diff_file
        echo "... (diff truncated, $diff_line_count total lines) ..." >>$actual_diff_file
    end

    # Extract ticket number if present
    set ticket_number ""
    if string match -qr '(\d+)' $branch_name
        set ticket_number (string match -r '\d+' $branch_name)
    end

    # Extract branch prefix hint
    set branch_hint ""
    if string match -qr '^([a-z]+)/' $branch_name
        set branch_hint (string match -r '^([a-z]+)/' $branch_name | string split '/')[1]
    end

    # Set section headers based on language
    set -l section_summary "## Summary"
    set -l section_changes "## Changes"
    set -l section_testing "## Testing"
    set -l section_breaking "## Breaking Changes"
    
    if test "$language" = "dk"
        set section_summary "## Resumé"
        set section_changes "## Ændringer"
        set section_testing "## Test"
        set section_breaking "## Breaking Changes"
    end

    # Build concise prompt for PR description
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
- Prefer lists, use backticks for \`files\`/\`functions\`/\`APIs\`, blank lines between sections

STRUCTURE:
$section_summary
1-2 sentence overview.

$section_changes
Lists only. Only substantive changes visible in diff. Skip files with only trivial changes.

$section_testing
Lists only. How tested, manual steps, coverage.

$section_breaking
ONLY if breaking changes in diff. Omit entirely if none.

Branch: $branch_name | Base: $main_branch | Files: "(string join ", " $changed_files)"
Commits: "(string join " | " $commit_messages)"

Diff below. Describe ONLY visible substantive changes. Skip trivial changes entirely."

    # Add context hints if available
    if test -n "$branch_hint"
        set prompt "$prompt
Branch type: $branch_hint"
    end

    # Note: Ticket references are handled by the platform, not included in PR description

    set prompt "$prompt

Output: Markdown PR description in $language_name. All text in $language_name. No explanations."

    # Run OpenCode with spinner and extract response
    set temp_prompt (mktemp -t opencode_prompt.XXXXXX)
    set temp_output (mktemp -t opencode_output.XXXXXX)
    set temp_pr_desc (mktemp).md

    # Write prompt to file, then append diff from file to avoid shell variable issues
    # Use printf to write the base prompt (same as ai_commit)
    printf '%s' "$prompt" >$temp_prompt
    echo "" >>$temp_prompt
    cat $actual_diff_file >>$temp_prompt
    
    # Cleanup temp diff file (only delete temp_diff if it's different from actual_diff_file)
    if test "$temp_diff" != "$actual_diff_file"
        rm -f $temp_diff
    end
    
    # Verify prompt file was written and has content
    if not test -s "$temp_prompt"
        gum style --foreground 1 " Error: Prompt file is empty"
        rm -f $temp_prompt $temp_output $temp_pr_desc
        return 1
    end
    
    # Check prompt file size
    set prompt_size (wc -c <$temp_prompt | string trim)
    if test $prompt_size -eq 0
        gum style --foreground 1 " Error: Prompt file has 0 bytes"
        rm -f $temp_prompt $temp_output $temp_pr_desc
        return 1
    end

    # Use gum spin to show loading indicator while AI is thinking
    # Use same approach as ai_commit - pass prompt via command substitution
    # Read the file and pass as argument, ensuring it's treated as a single argument
    gum spin --spinner pulse --title "󰚩 Analyzing changes with $ai_model..." -- sh -c "prompt_content=\$(cat '$temp_prompt'); opencode run -m $ai_model --format json \"\$prompt_content\" > $temp_output 2>&1"

    # Extract the text from JSON response and write directly to file to preserve newlines
    # jq -r outputs raw strings with newlines preserved, automatically unescaping \n sequences
    # Write directly to file to avoid any shell variable processing that might affect newlines
    cat $temp_output | sed 's/\x1b\[[0-9;]*m//g' | grep '^{' | jq -r 'select(.type == "text") | .part.text' 2>/dev/null >$temp_pr_desc

    # Check for errors in output (before deleting temp_output)
    set error_in_output (cat $temp_output | grep -i "error\|fail" | head -n 3)
    set json_lines (cat $temp_output | grep '^{' | head -n 5)

    # Cleanup temp prompt file
    rm -f $temp_prompt

    # Validate we got a response (check if file has content)
    if not test -s "$temp_pr_desc"
        gum style --foreground 1 " Failed to generate PR description"
        
        if test -n "$error_in_output"
            gum style --foreground 3 "Error details:"
            echo "$error_in_output"
        else if test -n "$json_lines"
            gum style --foreground 3 "Received JSON but couldn't extract text. JSON preview:"
            echo "$json_lines"
        else
            gum style --foreground 3 "OpenCode output (last 20 lines):"
            cat $temp_output | tail -n 20
        end
        
        rm -f $temp_output $temp_pr_desc
        return 1
    end
    
    # Cleanup temp output file after successful extraction
    rm -f $temp_output

    # Trim only the very first and last lines (not each line individually)
    # This preserves internal formatting and line breaks
    if test -s "$temp_pr_desc"
        # Remove leading blank lines
        sed -i '' '/./,$!d' "$temp_pr_desc" 2>/dev/null || sed -i '/./,$!d' "$temp_pr_desc" 2>/dev/null
        # Remove trailing blank lines  
        sed -i '' -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$temp_pr_desc" 2>/dev/null || sed -i -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$temp_pr_desc" 2>/dev/null
        # Ensure file ends with newline
        if test -s "$temp_pr_desc"
            printf '\n' >>"$temp_pr_desc"
        end
    end

    # Cleanup temp files
    rm -f $temp_prompt $temp_output

    # Validate we got a response (check if file has content)
    if not test -s "$temp_pr_desc"
        rm -f "$temp_pr_desc"
        gum style " Failed to generate PR description"
        return 1
    end

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
        -c "set statusline=%f\ %=[PR\ Description\ -\ :wq\ to\ save\ and\ exit] | normal! gg" \
        "$temp_pr_desc"

    # Check if file still exists (user might have deleted it or cancelled)
    if not test -f "$temp_pr_desc"
        gum style --foreground 1 "󰜺 PR description cancelled"
        return 1
    end

    # Read the edited content
    set edited_content (cat "$temp_pr_desc" 2>/dev/null | string trim)

    # If user cleared the content completely, cancel
    if test -z "$edited_content"
        rm -f "$temp_pr_desc"
        gum style --foreground 1 "󰜺 PR description cancelled (empty content)"
        return 1
    end

    # Copy to clipboard based on platform
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
        printf '%s' "$edited_content" | $clipboard_cmd
        if test $status -eq 0
            gum style --foreground 2 "󰸞 PR description copied to clipboard!"
        else
            gum style --foreground 1 "󱎘 Failed to copy to clipboard"
        end
    else
        gum style --foreground 3 "󰦨 Clipboard command not found, displaying content:"
        echo "$edited_content"
    end

    # Cleanup temp file
    rm -f "$temp_pr_desc"
end

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
        rm -rf $subfolder
        git branch --merged | egrep -v "$subfolder" | xargs --no-run-if-empty git branch -d
    end
end

function first_login_of_the_day
    set silent (string match -- "--silent" $argv)
    set current_date (date "+%y-%m-%d")
    set cached_time (bat_fast "/tmp/.first_login/$current_date" 2> /dev/null)

    if test -n "$cached_time"
        # join the date and time global variable
        wezterm_set_user_var first_login $cached_time
        if test -n "$silent"
            return
        end
        echo $cached_time
        return
    end
    set login_item (log show --style syslog --predicate 'process == "loginwindow"' --debug --info --last 8h | rg --max-count=1 "LUIAuthenticationServiceProvider deactivateWithContext:]_block_invoke")

    # extract the date from the log
    set date (echo $login_item | rg -o -N '\d{4}-\d{2}-\d{2}\b' )
    set time (echo $login_item | rg -o -N '\d{2}:\d{2}:\d{2}\b' )

    # cache the result
    mkdir -p /tmp/.first_login
    wezterm_set_user_var first_login $time
    echo $time >/tmp/.first_login/$current_date

    if test -n "$silent"
        return
    end
    echo $cached_time
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

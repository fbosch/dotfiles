function ai_commit --description 'Generate AI-powered Commitizen commit message from branch context'
    argparse d/dry v/verbose -- $argv
    or return 1

    set -l dry_run (set -q _flag_dry; and echo true; or echo false)

    if not git rev-parse --git-dir >/dev/null 2>&1
        gum style " Not in a git repository"
        return 1
    end
    set -l staged_files (git diff --cached --name-only)
    if test -z "$staged_files"
        gum style " No staged changes to commit"
        return 1
    end

    if set -q _flag_verbose
        echo "Branch: "(git rev-parse --abbrev-ref HEAD)
    end

    function __ai_commit_run -S
        set -l temp_output (mktemp -t opencode_output.XXXXXX)
        set -l temp_label (mktemp -t opencode_label.XXXXXX)
        echo "Analyzing..." >$temp_label

        # Spinner loop in background: reads label file and animates
        fish -c '
            set frames ⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏
            set i 1
            while true
                set label (cat $argv[1] 2>/dev/null)
                printf "\r\033[K󰚩 %s %s" $frames[$i] $label >/dev/tty
                set i (math "$i % "(count $frames)" + 1")
                sleep 0.08
            end
        ' -- "$temp_label" &
        set -l spin_pid $last_pid

        set -l branch (git rev-parse --abbrev-ref HEAD 2>/dev/null)
        set -l prev_commit (git log -1 --pretty=format:"%s" 2>/dev/null)
        set -l staged_diff (git diff --cached --ignore-all-space -- ':!*-lock.*' ':!*.lock' 2>/dev/null)
        set -l prompt "Branch: $branch\nPrevious commit: $prev_commit\n\nSTAGED DIFF:\n$staged_diff"
        opencode_transient_run run --agent commit --format json "$prompt" 2>/dev/null \
            | tee $temp_output \
            | while read -l line
            set -l typ (echo $line | jq -r '.type // empty' 2>/dev/null)
            if test "$typ" = reasoning
                set -l text (echo $line | jq -r '.part.text // empty' 2>/dev/null | string trim | string split "\n")[1]
                test -n "$text"; and echo (string sub -l 72 -- $text) >$temp_label
            end
        end

        kill $spin_pid 2>/dev/null
        printf '\r\033[K' >/dev/tty
        rm -f $temp_label

        cp $temp_output /tmp/opencode_last.jsonl 2>/dev/null
        set -l result (cat $temp_output | sed 's/\x1b\[[0-9;]*m//g' | grep '^{' \
            | jq -r 'select(.type == "text") | .part.text' 2>/dev/null \
            | tail -n 1 | string trim)
        rm -f $temp_output
        echo $result
    end

    set -l raw_output (__ai_commit_run)

    if test -z "$raw_output"
        gum style --foreground 1 " Failed to generate commit message"
        functions -e __ai_commit_run
        return 1
    end

    set -l commit_msg (__extract_commit_msg "$raw_output")

    if test -z "$commit_msg"
        gum style " Failed to extract valid commit message"
        gum style --foreground 3 "Raw output:"
        echo "$raw_output"
        functions -e __ai_commit_run
        return 1
    end

    set -l msg_length (string length -- "$commit_msg")
    if test "$msg_length" -gt 50
        printf '\033[s' # save cursor position
        gum style --foreground 3 " Message is $msg_length chars (over 50)"
        gum style --foreground 6 "Generated message:"
        gum style --foreground 208 "  $commit_msg"
        set -l length_action (gum choose --header "Pick an action" "Edit current message" "Retry" "Cancel")
        set -l choose_status $status
        printf '\033[u\033[J' # restore cursor, clear to end of screen
        if test $choose_status -ne 0
            gum style --foreground 1 "󰜺 Commit cancelled"
            functions -e __ai_commit_run
            return 1
        end

        if test "$length_action" = Retry
            set raw_output (__ai_commit_run)
            if test -z "$raw_output"
                gum style --foreground 1 " Failed to generate commit message"
                functions -e __ai_commit_run
                return 1
            end
            set commit_msg (__extract_commit_msg "$raw_output")
            if test -z "$commit_msg"
                gum style --foreground 1 " Failed to extract valid commit message"
                functions -e __ai_commit_run
                return 1
            end
            set msg_length (string length -- "$commit_msg")
            if test "$msg_length" -gt 50
                gum style --foreground 3 " Message is $msg_length chars (over 50) — edit before committing"
            end
        else if test "$length_action" = Cancel
            gum style --foreground 1 "󰜺 Commit cancelled"
            functions -e __ai_commit_run
            return 1
        end
    end

    functions -e __ai_commit_run

    set -l edited_msg (gum input --value="$commit_msg" --width 100 --prompt "󰏫 " --placeholder "Edit commit message or press Enter to accept...")
    if test $status -ne 0
        gum style --foreground 1 "󰜺 Commit cancelled"
        return 1
    end
    if test -z "$edited_msg"
        gum style --foreground 1 "󰜺 Commit cancelled (empty message)"
        return 1
    end

    gum style --foreground 208 "$edited_msg"

    # Cross-platform clipboard copy
    set -l clipboard_cmd pbcopy
    if test (uname) != Darwin
        if command -v wl-copy >/dev/null 2>&1
            set clipboard_cmd wl-copy
        else if command -v xclip >/dev/null 2>&1
            set clipboard_cmd "xclip -selection clipboard"
        else
            set clipboard_cmd ""
        end
    end
    if test -n "$clipboard_cmd"
        printf "git commit -m \"%s\"" "$edited_msg" | eval $clipboard_cmd
    end

    if test "$dry_run" = true
        gum style --foreground 6 "🔍 Dry run - would execute:"
        gum style --foreground 2 "  git commit -m \"$edited_msg\""
        gum style --foreground 6 "\nStaged files:"
        git diff --cached --name-only | sed 's/^/  /'
        return 0
    end

    history add git\ commit\ -m\ "$edited_msg" >/dev/null 2>&1
    git commit -m "$edited_msg"
    set -l commit_status $status

    if test $commit_status -eq 0
        gum style --foreground 2 "󱚣 Commit successful!"
    else
        gum style --foreground 1 "󱚡 Commit failed"
        return 1
    end
end

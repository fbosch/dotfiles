function wtfzf --description 'Pick git worktree quickly via git porcelain'
    set -l cmd_name wtfzf

    for cmd in git fzf
        if not command -v $cmd >/dev/null 2>&1
            echo "$cmd_name: '$cmd' is required" >&2
            return 127
        end
    end

    if not git rev-parse --git-dir >/dev/null 2>&1
        echo "$cmd_name: run this from inside a git repository" >&2
        return 1
    end

    set -l tab (printf '\t')
    set -l current_path (pwd -P)
    set -l porcelain (git worktree list --porcelain 2>/dev/null)
    set -l list_exit_code $status

    if test $list_exit_code -ne 0
        return $list_exit_code
    end

    if test -z "$porcelain"
        return 1
    end

    set -l worktree_rows
    set -l path ''
    set -l branch ''

    function __wtfzf_flush --no-scope-shadowing
        if test -z "$path"
            return
        end

        set -l marker ' '
        if test "$path" = "$current_path"
            set marker '*'
        end

        set -l branch_name "$branch"
        if test -z "$branch_name"
            set branch_name '(detached)'
        end

        set -a worktree_rows "$path$tab$marker  $branch_name  $path"
    end

    for line in $porcelain
        if string match -q 'worktree *' -- "$line"
            __wtfzf_flush
            set path (string replace -r '^worktree ' '' -- "$line")
            set branch ''
            continue
        end

        if string match -q 'branch refs/heads/*' -- "$line"
            set branch (string replace -r '^branch refs/heads/' '' -- "$line")
            continue
        end

        if test -z "$line"
            __wtfzf_flush
            set path ''
            set branch ''
        end
    end
    __wtfzf_flush
    functions -e __wtfzf_flush

    set -l count_rows (count $worktree_rows)
    if test $count_rows -le 1
        return 1
    end

    set -l selected (
        printf "%s\n" $worktree_rows \
        | fzf \
            --delimiter="$tab" \
            --with-nth=2 \
            --prompt='wt> ' \
            --height='85%' \
            --layout=reverse \
            --border=rounded \
            --info=inline-right \
            --header='enter: cd into worktree' \
            < /dev/tty
    )
    set -l exit_code $status

    if test $exit_code -ne 0 -o -z "$selected"
        return $exit_code
    end

    set -l selected_path (string split -f 1 $tab -- "$selected")
    if test -z "$selected_path" -o ! -d "$selected_path"
        return 1
    end

    if test "$selected_path" = "$current_path"
        return 0
    end

    cd "$selected_path"
    commandline --function repaint
end

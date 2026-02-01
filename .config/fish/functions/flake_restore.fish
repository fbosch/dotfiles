function flake_restore --description "Browse flake.lock history and restore a version"
    set -l repo (git rev-parse --show-toplevel 2>/dev/null)
    if test -z "$repo"
        echo "Not inside a git repository."
        return 1
    end

    if not type -q fzf
        echo "fzf is required for interactive selection."
        return 1
    end

    set -l file "$repo/flake.lock"
    if not test -f "$file"
        echo "flake.lock not found at repo root."
        return 1
    end

    set -l sep (printf '\x1f')
    set -l log_cmd "git -C $repo log --follow --date=short --pretty=format:'%h%x1f%ad%x1f%s' -- flake.lock"
    set -l selection (eval $log_cmd | fzf --delimiter "$sep" --with-nth 1,2,3 --prompt "flake.lock history> " --preview "git -C $repo -c color.ui=always show {1} -- flake.lock")

    if test -z "$selection"
        return 0
    end

    set -l parts (string split $sep -- $selection)
    set -l hash $parts[1]
    set -l date $parts[2]
    set -l subject $parts[3]

    set -l commit_url ""
    set -l remote (git -C $repo remote get-url origin 2>/dev/null)
    if test -n "$remote"
        set -l base (string replace -r '\.git$' '' -- $remote)
        set base (string replace -r '^git@github.com:' 'https://github.com/' -- $base)
        set base (string replace -r '^https://github.com/' 'https://github.com/' -- $base)
        set commit_url "$base/commit/$hash"
    end

    set -l dep_count "?"
    set -l dep_lines
    if type -q jq
        set -l tmp (mktemp)
        if git -C $repo show "$hash:flake.lock" >"$tmp" 2>/dev/null
            set -l dep_list (jq -r -s '
                def depmap($x):
                    $x.nodes
                    | to_entries
                    | map({key, value: (.value.locked // {})})
                    | from_entries;
                def get($m; $k):
                    $m[$k] // {};
                depmap(.[0]) as $a
                | depmap(.[1]) as $b
                | ($a + $b)
                | keys[]
                | . as $k
                | (get($a; $k)) as $cur
                | (get($b; $k)) as $sel
                | select($cur != $sel)
                | ($cur.lastModified // 0 | tonumber) as $clm
                | ($sel.lastModified // 0 | tonumber) as $slm
                | (if ($cur.rev // "") == "" then "added"
                   elif ($sel.rev // "") == "" then "removed"
                   elif $slm > $clm then "upgrade"
                   elif $slm < $clm then "downgrade"
                   else "changed" end) as $dir
                | [$k, ($cur.rev // "-"), ($sel.rev // "-"), $dir]
                | @tsv
            ' "$file" "$tmp")
            set dep_count (count $dep_list)
            if test $dep_count -gt 0
                set dep_lines $dep_list
            end
        end
        rm -f "$tmp"
    end

    set -l dirty (git -C $repo status --porcelain -- flake.lock)
    if test -n "$dirty"
        echo "flake.lock has local changes. Restoring will overwrite them."
    end

    set -l lines "flake.lock restore" "" "Commit:  $hash" "Date:    $date" "Subject: $subject"
    if test -n "$commit_url"
        set lines $lines "Link:    $commit_url"
    end

    if test "$dep_count" != "?"
        if test $dep_count -gt 0
            set lines $lines "" "Deps:    $dep_count changed" \n""
            set -l tab (printf '\t')
            set -l reset (set_color normal)
            set -l green (set_color green)
            set -l red (set_color red)
            set -l yellow (set_color yellow)

            set -l up_lines
            set -l down_lines
            set -l add_lines
            set -l remove_lines
            set -l change_lines

            for dep in $dep_lines
                set -l row (string split $tab -- $dep)
                set -l name $row[1]
                set -l from $row[2]
                set -l to $row[3]
                set -l dir $row[4]

                if test "$from" != -
                    set from (string sub -s -7 -- $from)
                end
                if test "$to" != -
                    set to (string sub -s -7 -- $to)
                end

                if test (string length -- $name) -gt 28
                    set name (string sub -s 1 -l 25 -- $name)"..."
                end

                switch $dir
                    case upgrade
                        set -a up_lines (printf "%s[%sU%s.] %s  %s -> %s" $reset $green $reset $name $from $to)
                    case downgrade
                        set -a down_lines (printf "%s[%sD%s.] %s  %s -> %s" $reset $red $reset $name $from $to)
                    case added
                        set -a add_lines (printf "%s[%sA%s+] %s  %s" $reset $green $reset $name $to)
                    case removed
                        set -a remove_lines (printf "%s[%sR%s-] %s  %s" $reset $red $reset $name $from)
                    case changed
                        set -a change_lines (printf "%s[%sC%s.] %s  %s -> %s" $reset $yellow $reset $name $from $to)
                end
            end

            if test (count $up_lines) -gt 0
                set lines $lines "" UPGRADING
                for item in $up_lines
                    set lines $lines "$green$item$reset"
                end
            end

            if test (count $down_lines) -gt 0
                set lines $lines "" DOWNGRADING
                for item in $down_lines
                    set lines $lines "$red$item$reset"
                end
            end

            if test (count $add_lines) -gt 0
                set lines $lines "" ADDING
                for item in $add_lines
                    set lines $lines "$green$item$reset"
                end
            end

            if test (count $remove_lines) -gt 0
                set lines $lines "" REMOVING
                for item in $remove_lines
                    set lines $lines "$red$item$reset"
                end
            end

            if test (count $change_lines) -gt 0
                set lines $lines "" CHANGING
                for item in $change_lines
                    set lines $lines "$yellow$item$reset"
                end
            end
        else
            set lines $lines "" "Deps:    0 changed"
        end
    end

    for line in $lines
        if test -n "$line"
            printf "%s\n" "$line"
        end
    end

    if type -q gum
        gum confirm "Restore flake.lock to this commit?"; or return 1
        set confirm y
    else
        read -l -P "Restore flake.lock? [y/N] " confirm
    end

    if test "$confirm" != y
        return 0
    end

    if git -C $repo restore --source=$hash -- flake.lock 2>/dev/null
        echo "Restored flake.lock from $hash."
    else
        git -C $repo show "$hash:flake.lock" >"$file"
        echo "Restored flake.lock from $hash (via git show)."
    end
end

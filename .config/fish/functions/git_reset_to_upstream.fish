function git_reset_to_upstream --description 'Reset current branch to upstream after fetch'
    if not git rev-parse --git-dir >/dev/null 2>&1
        echo "Not in a git repository" >&2
        return 1
    end

    set -l branch (git symbolic-ref --quiet --short HEAD 2>/dev/null)
    if test -z "$branch"
        echo "Detached HEAD; aborting" >&2
        return 1
    end

    set -l upstream (git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)
    if test -z "$upstream"
        echo "Current branch has no upstream; aborting" >&2
        return 1
    end

    set -l remote (string split / -- $upstream)[1]
    if test -z "$remote"
        echo "Could not resolve upstream remote; aborting" >&2
        return 1
    end

    echo "Fetching latest from $remote..."
    git fetch --prune $remote
    or return $status

    set -l status_lines (git status --short)
    if test -n "$status_lines"
        echo "Working tree has local changes:"
        printf "%s\n" $status_lines

        read -l -P "Reset $branch to $upstream and discard local commits plus tracked changes? Untracked files are kept. Continue? [y/N] " confirm
        if not contains -- (string lower -- "$confirm") y yes
            echo "Aborted"
            return 1
        end
    end

    echo "Resetting $branch to $upstream..."
    git reset --hard '@{u}'
end

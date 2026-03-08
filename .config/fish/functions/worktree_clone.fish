function worktree_clone --description 'Bare-clone a repo and open the first worktree'
    if not command -v git >/dev/null 2>&1
        echo (set_color red)"git is required but not found."(set_color normal) >&2
        return 1
    end

    if test (count $argv) -lt 1
        echo (set_color yellow)"Usage: worktree_clone <url> [directory]"(set_color normal) >&2
        return 1
    end

    set -l orig_dir (pwd)
    set -l url "$argv[1]"
    set -l name

    if test (count $argv) -ge 2
        set name "$argv[2]"
    else
        set -l normalized_url (string trim --right --chars=/ -- "$url")
        set -l path_tail (string split -r -m1 / -- "$normalized_url")[-1]
        set name (string split -r -m1 : -- "$path_tail")[-1]
        set name (string replace -r '\.git$' '' -- "$name")
    end

    if test -z "$name"
        echo (set_color red)"Could not infer target directory name from '$url'."(set_color normal) >&2
        return 1
    end

    if test -e "$name"
        echo (set_color yellow)"Directory '$name' already exists. Aborting!"(set_color normal) >&2
        return 1
    end

    mkdir -p "$name"
    or return 1

    git clone --bare "$url" "$name/.bare"
    or begin
        rm -rf "$name"
        return 1
    end

    ln -s .bare "$name/.git"
    or begin
        rm -rf "$name"
        return 1
    end

    git -C "$name/.bare" config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
    or begin
        rm -rf "$name"
        return 1
    end

    git -C "$name/.bare" fetch origin
    or echo (set_color yellow)"Warning: failed to fetch origin; continuing with cloned refs."(set_color normal) >&2

    set -l default_branch (git -C "$name/.bare" symbolic-ref HEAD 2>/dev/null | string replace 'refs/heads/' '')
    if test -z "$default_branch"
        set default_branch (git -C "$name/.bare" ls-remote --symref origin HEAD 2>/dev/null | string match -r --groups-only 'ref: refs/heads/([^[:space:]]+)')
    end
    if test -z "$default_branch"
        echo (set_color yellow)"Warning: could not detect the default branch; assuming 'main'."(set_color normal) >&2
        set default_branch main
    end

    echo (set_color cyan)"Default branch: $default_branch"(set_color normal)
    echo (set_color cyan)"Creating first worktree..."(set_color normal)

    set -l target_ref "$default_branch"
    git -C "$name/.bare" show-ref --verify --quiet "refs/heads/$default_branch"
    if test $status -ne 0
        set target_ref "origin/$default_branch"
    end

    set -l worktree_dir "$orig_dir/$name/$default_branch"

    git -C "$name/.bare" worktree add "$worktree_dir" "$target_ref"
    or begin
        cd "$orig_dir"
        rm -rf "$name"
        return 1
    end

    if test -d "$worktree_dir"
        cd "$worktree_dir"
        or begin
            cd "$orig_dir"
            rm -rf "$name"
            return 1
        end
    else
        cd "$orig_dir"
        rm -rf "$name"
        echo (set_color red)"git did not create expected worktree directory '$worktree_dir'."(set_color normal) >&2
        return 1
    end

    set -l head_branch (git -C "$worktree_dir" symbolic-ref --quiet --short HEAD 2>/dev/null)
    if test -n "$head_branch"
        git -C "$name/.bare" show-ref --verify --quiet "refs/remotes/origin/$head_branch"
        if test $status -eq 0
            git -C "$worktree_dir" branch --set-upstream-to="origin/$head_branch" "$head_branch" >/dev/null 2>&1
            or echo (set_color yellow)"Warning: failed to set upstream for '$head_branch' to 'origin/$head_branch'."(set_color normal) >&2
        else
            echo (set_color yellow)"Warning: origin/$head_branch not found; upstream not set."(set_color normal) >&2
        end
    else
        echo (set_color yellow)"Warning: HEAD is detached; upstream not set."(set_color normal) >&2
    end

    echo (set_color green)"Ready."(set_color normal)
end

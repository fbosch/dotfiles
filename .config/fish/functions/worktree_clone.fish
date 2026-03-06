function worktree_clone --description 'Bare-clone a repo and open first worktree with worktrunk'
    if not command -v git >/dev/null
        echo (set_color red)"git is required but not found."(set_color normal)
        return 1
    end

    if not command -v wt >/dev/null
        echo (set_color red)"worktrunk (wt) is required but not found."(set_color normal)
        return 1
    end

    if test (count $argv) -lt 1
        echo (set_color yellow)"Usage: worktree_clone <url> [directory]"(set_color normal)
        return 1
    end

    set -l url "$argv[1]"
    set -l name

    if test (count $argv) -ge 2
        set name "$argv[2]"
    else
        set name (basename "$url" .git)
    end

    if test -z "$name"
        echo (set_color red)"Could not infer target directory name."(set_color normal)
        return 1
    end

    if test -e "$name"
        echo (set_color yellow)"Directory '$name' already exists. Aborting!"(set_color normal)
        return 1
    end

    echo (set_color cyan)"Cloning bare repository into $name/.git..."(set_color normal)
    git clone --bare "$url" "$name/.git"
    or return 1

    git -C "$name/.git" config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
    git -C "$name/.git" fetch origin

    set -l default_branch (git -C "$name/.git" symbolic-ref HEAD 2>/dev/null | string replace 'refs/heads/' '')
    if test -z "$default_branch"
        set default_branch main
    end

    echo (set_color cyan)"Default branch: $default_branch"(set_color normal)
    echo (set_color cyan)"Creating first worktree..."(set_color normal)

    cd "$name"
    wt switch "$default_branch"
    or wt switch --create "$default_branch"
    or return 1

    echo (set_color green)"Ready. Use 'wt switch -c <branch>' for new worktrees."(set_color normal)
end

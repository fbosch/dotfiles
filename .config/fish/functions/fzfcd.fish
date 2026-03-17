function fzfcd
    set -l selected_dir
    if test -f .git
        # if current directory is a .bare git repository, search for child directories contains .git folders only
        set selected_dir (fd -tf --max-depth=4 --color=never '.git$' -H | rev | cut -c 6- | rev | fzf --preview "lt {}" --preview-window "25%" < /dev/tty)
    else
        set selected_dir (fd -td --max-depth=4 --color=never --hidden | fzf --preview "lt {}" --preview-window "25%" < /dev/tty)
    end
    if test -n "$selected_dir"
        cd "$selected_dir"
        commandline --function repaint
    end
end

function fzfcd
    set -l tmp (mktemp)
    if test -f .git
        # if current directory is a .bare git repository, search for child directories contains .git folders only
        fd -tf --max-depth=4 --color=never '.git$' -H | rev | cut -c 6- | rev | fzf --preview "lt {}" --preview-window "25%" > $tmp < /dev/tty
    else
        fd -td --max-depth=4 --color=never --hidden | fzf --preview "lt {}" --preview-window "25%" > $tmp < /dev/tty
    end
    set -l selected_dir (cat $tmp)
    rm -f $tmp
    if test -n "$selected_dir"
        z "$selected_dir"
        commandline --function repaint
    end
end

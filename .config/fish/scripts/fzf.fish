# FZF directory navigation

function fzfcd
    if test -d .git -a -f .git/HEAD
        # if current directory is a .bare git repository, search for child directories contains .git folders only
        set selected_dir (fd -tf --max-depth=4 --color=never '.git$' -H | rev | cut -c 6- | rev | fzf --preview "lt {}" --preview-window "25%")
    else
        set selected_dir (fd -td --max-depth=4 --color=never | fzf --preview "lt {}" --preview-window "25%")
    end
    if test -n "$selected_dir"
        z "$selected_dir" # Change directory if selection is not empty
        commandline --function repaint
    end
end

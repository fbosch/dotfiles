function git_add_gum
    if test -z "$files"
        echo (set_color --bold --background=yellow black)"[NOTICE] No changes to stage."(set_color normal)
        return
    end
    set selected (printf "%s\n" $files | gum choose --no-limit --header="   Select files to stage")
    git add $selected
end

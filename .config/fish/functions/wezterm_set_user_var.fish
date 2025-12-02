function wezterm_set_user_var
    if hash base64 2>/dev/null
        if test -z "$TMUX"
            printf "\033]1337;SetUserVar=%s=%s\007" "$argv[1]" (echo -n "$argv[2]" | base64)
        else
            # <https://github.com/tmux/tmux/wiki/FAQ#what-is-the-passthrough-escape-sequence-and-how-do-i-use-it>
            printf "\033Ptmux;\033\033]1337;SetUserVar=%s=%s\007\033\\" "$argv[1]" (echo -n "$argv[2]" | base64)
        end
    end
    commandline --function repaint
end

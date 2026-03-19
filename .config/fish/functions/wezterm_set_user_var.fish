function wezterm_set_user_var
    if hash base64 2>/dev/null
        set -l encoded_value (echo -n "$argv[2]" | base64)

        if status is-command-substitution
            if status is-interactive
                if test -z "$TMUX"
                    printf "\033]1337;SetUserVar=%s=%s\007" "$argv[1]" "$encoded_value" >/dev/tty 2>/dev/null
                else
                    # <https://github.com/tmux/tmux/wiki/FAQ#what-is-the-passthrough-escape-sequence-and-how-do-i-use-it>
                    printf "\033Ptmux;\033\033]1337;SetUserVar=%s=%s\007\033\\" "$argv[1]" "$encoded_value" >/dev/tty 2>/dev/null
                end
            end
        else if test -z "$TMUX"
            printf "\033]1337;SetUserVar=%s=%s\007" "$argv[1]" "$encoded_value"
        else
            # <https://github.com/tmux/tmux/wiki/FAQ#what-is-the-passthrough-escape-sequence-and-how-do-i-use-it>
            printf "\033Ptmux;\033\033]1337;SetUserVar=%s=%s\007\033\\" "$argv[1]" "$encoded_value"
        end
    end

    if status is-interactive
        commandline --function repaint
    end
end

. ~/.config/fish/scripts.fish

function wezterm_set_user_var
    if hash base64 2>/dev/null
        if test -z "$TMUX"
            printf "\033]1337;SetUserVar=%s=%s\007" "$argv[1]" (echo -n "$argv[2]" | base64)
        else
            # <https://github.com/tmux/tmux/wiki/FAQ#what-is-the-passthrough-escape-sequence-and-how-do-i-use-it>
            # Note that you ALSO need to add "set -g allow-passthrough on" to your tmux.conf
            printf "\033Ptmux;\033\033]1337;SetUserVar=%s=%s\007\033\\" "$argv[1]" (echo -n "$argv[2]" | base64)
        end
    end
end

if test (uname -s) = "Darwin"
  while true 
    set -Ux HOURS_WORKED (hours_since_workday_start)
    wezterm_set_user_var "HOURS_WORKED" $HOURS_WORKED
    # wait for 5 minutes
    sleep 300
  end
end

function ctrl_h_herdr --description 'Launch herdr'
    set -l notify_send (command -v notify-send)
    if test -n "$notify_send"
        set -lx HERDR_NOTIFY_SEND_REAL "$notify_send"
        set -lx PATH "$HOME/.config/fish/libexec" $PATH
    end

    if command -v mullvad-exclude >/dev/null
        command mullvad-exclude herdr
    else
        command herdr
    end

    if status --is-interactive
        commandline --function repaint repaint-mode
    end
end

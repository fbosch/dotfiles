function ctrl_h_herdr --description 'Launch herdr'
    if command -v mullvad-exclude >/dev/null
        command mullvad-exclude herdr
    else
        command herdr
    end

    if status --is-interactive
        commandline --function repaint repaint-mode
    end
end

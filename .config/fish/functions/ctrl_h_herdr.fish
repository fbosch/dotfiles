function ctrl_h_herdr --description 'Launch herdr'
    if type -q mullvad-exclude
        command mullvad-exclude herdr
    else
        command herdr
    end

    if status --is-interactive
        commandline --function repaint repaint-mode
    end
end

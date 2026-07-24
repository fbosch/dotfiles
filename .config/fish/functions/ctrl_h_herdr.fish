function ctrl_h_herdr --description 'Launch herdr'
    command herdr

    if status --is-interactive
        commandline --function repaint repaint-mode
    end
end

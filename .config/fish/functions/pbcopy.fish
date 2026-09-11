function pbcopy --description 'Copy stdin to the system clipboard'
    set -l backend (__clipboard_backend)
    if test $status -ne 0
        printf 'pbcopy: no supported clipboard backend found\n' >&2
        return 127
    end

    switch $backend
        case darwin
            # Bypass this wrapper and invoke macOS's native command.
            command pbcopy $argv
        case wayland
            command wl-copy $argv
        case xclip
            command xclip -selection clipboard $argv
        case xsel
            command xsel --clipboard --input $argv
    end
end

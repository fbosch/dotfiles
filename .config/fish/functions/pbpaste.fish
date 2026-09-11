function pbpaste --description 'Paste the system clipboard to stdout'
    set -l backend (__clipboard_backend)
    if test $status -ne 0
        printf 'pbpaste: no supported clipboard backend found\n' >&2
        return 127
    end

    switch $backend
        case darwin
            # Bypass this wrapper and invoke macOS's native command.
            command pbpaste $argv
        case wayland
            command wl-paste $argv
        case xclip
            command xclip -selection clipboard -o $argv
        case xsel
            command xsel --clipboard --output $argv
    end
end

function copykey
    set clipboard_cmd pbcopy
    if test (uname) != Darwin
        if command -v wl-copy >/dev/null 2>&1
            set clipboard_cmd wl-copy
        else if command -v xclip >/dev/null 2>&1
            set clipboard_cmd "xclip -selection clipboard"
        else
            echo "Error: No clipboard command found (pbcopy/wl-copy/xclip)" >&2
            return 1
        end
    end
    eval $clipboard_cmd <~/.ssh/id_rsa.pub
end

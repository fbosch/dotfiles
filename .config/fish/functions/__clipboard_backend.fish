function __clipboard_backend --description 'Select the available clipboard backend'
    switch (uname)
        case Darwin
            if command -v pbcopy >/dev/null 2>&1; and command -v pbpaste >/dev/null 2>&1
                printf '%s\n' darwin
                return 0
            end
        case Linux FreeBSD NetBSD OpenBSD DragonFly
            # Prefer the native session backend; XWayland may expose only X11 tools.
            if test "$XDG_SESSION_TYPE" = wayland; or test -n "$WAYLAND_DISPLAY"
                if command -v wl-copy >/dev/null 2>&1; and command -v wl-paste >/dev/null 2>&1
                    printf '%s\n' wayland
                    return 0
                end
            end

            if test "$XDG_SESSION_TYPE" = x11; or test -n "$DISPLAY"
                if command -v xclip >/dev/null 2>&1
                    printf '%s\n' xclip
                    return 0
                else if command -v xsel >/dev/null 2>&1
                    printf '%s\n' xsel
                    return 0
                end
            end
    end

    return 127
end

function open --description 'Open file in default application (cross-platform)'
    set -l options h/help
    argparse -n open $options -- $argv
    or return

    if set -q _flag_help
        echo "Usage: open [FILE|DIRECTORY]..."
        echo "Open files or directories in their default applications"
        return 0
    end

    if test (count $argv) -eq 0
        echo "open: Expected at least 1 argument, got 0" >&2
        return 1
    end

    switch (uname)
        case Darwin
            # macOS: use native open command
            command open $argv
        case Linux
            # Linux: use xdg-open in background to prevent terminal output
            for item in $argv
                nohup xdg-open "$item" >/dev/null 2>&1 &
                disown
            end
        case '*'
            # Fallback for other systems (BSD, etc.)
            for item in $argv
                if command -v xdg-open >/dev/null
                    nohup xdg-open "$item" >/dev/null 2>&1 &
                    disown
                else
                    echo "open: No suitable open command found for this platform" >&2
                    return 1
                end
            end
    end
end

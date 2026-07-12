function gamescope_kill --description 'Force quit selected gamescope processes'
    set -l options h/help
    argparse -n gamescope_kill $options -- $argv
    or return

    if set -q _flag_help
        echo "Usage: gamescope_kill"
        echo "Select running gamescope processes to force quit"
        return 0
    end

    if not command -v gum >/dev/null
        echo "gamescope_kill: gum not found" >&2
        return 1
    end

    set -l processes (pgrep -a -f '(^|/)gamescope([[:space:]]|$)')
    if test $status -eq 1
        echo "gamescope_kill: no running gamescope processes" >&2
        return 1
    end

    if test $status -ne 0
        echo "gamescope_kill: failed to list gamescope processes" >&2
        return 1
    end

    set -l selected (printf '%s\n' $processes | gum choose --no-limit --header='Select gamescope processes to force quit')
    if test $status -ne 0
        return 0
    end

    for process in $selected
        set -l fields (string split -m 1 ' ' -- $process)
        set -l pid $fields[1]

        if kill -9 $pid 2>/dev/null
            echo "Force quit: $process"
        else
            echo "gamescope_kill: failed to force quit PID $pid" >&2
        end
    end
end

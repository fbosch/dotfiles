function ctrl_h_herdr --description 'Launch herdr'
    switch (uname)
        case Linux
            # Keep the server and its panes outside UWSM's graphical cgroup.
            if type -q systemd-run; and not command herdr status server >/dev/null 2>&1
                set -l herdr_bin (command -s herdr)
                if type -q mullvad-exclude
                    command systemd-run --user --unit=herdr-server.service --collect --same-dir --quiet \
                        mullvad-exclude $herdr_bin server >/dev/null 2>&1
                else
                    command systemd-run --user --unit=herdr-server.service --collect --same-dir --quiet \
                        $herdr_bin server >/dev/null 2>&1
                end

                if test $status -ne 0
                    printf 'Failed to start the Herdr server outside UWSM.\n' >&2
                    return 1
                end

                for attempt in (seq 1 50)
                    command herdr status server >/dev/null 2>&1; and break
                    sleep 0.1
                end

                if not command herdr status server >/dev/null 2>&1
                    printf 'Herdr server did not become ready.\n' >&2
                    return 1
                end
            end
    end

    if type -q mullvad-exclude
        command mullvad-exclude herdr
    else
        command herdr
    end

    if status --is-interactive
        commandline --function repaint repaint-mode
    end
end

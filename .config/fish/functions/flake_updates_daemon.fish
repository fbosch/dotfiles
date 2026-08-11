function flake_updates_daemon --description 'Manage the flake update checker service'
    set action $argv[1]

    switch $action
        case start
            systemctl --user start flake-update-checker.service
        case stop
            systemctl --user stop flake-update-checker.service
        case restart
            systemctl --user restart flake-update-checker.service
        case status
            systemctl --user status flake-update-checker.service --no-pager
        case enable
            systemctl --user enable --now flake-update-checker.timer
        case disable
            systemctl --user disable --now flake-update-checker.timer
        case refresh
            systemctl --user start flake-update-checker.service
            or return

            if command -q ags
                ags request -i start-menu-daemon '{"action":"refresh"}' >/dev/null 2>&1
            end
        case '*'
            echo "Usage: flake_updates_daemon {start|stop|restart|status|enable|disable|refresh}"
            return 1
    end
end

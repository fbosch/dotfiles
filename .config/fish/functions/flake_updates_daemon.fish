function flake_updates_daemon --description 'Manage the flake updates checker systemd service'
    set action $argv[1]
    
    switch $action
        case start
            systemctl --user start flake-update-checker.service
            echo "Started flake updates checker service"
            
        case stop
            systemctl --user stop flake-update-checker.service
            echo "Stopped flake updates checker service"
            
        case restart
            systemctl --user restart flake-update-checker.service
            echo "Restarted flake updates checker service"
            
        case status
            # Show systemd service status
            systemctl --user status flake-update-checker.service --no-pager
            
            # Show update info from JSON cache
            set -l helper_dir (path dirname (status filename))
            set -l fish_root (path resolve "$helper_dir/..")
            set -l libexec_dir "$fish_root/libexec"
            set -l helper "$libexec_dir/nix/cache_status.ts"
            if test -f "$helper"
                set -l cache_lines (bun --cwd "$libexec_dir" "$helper")
            end

            if test $status -eq 0 -a -n "$cache_lines"
                echo ""
                echo "=== Cache Contents ==="
                set -l count 0
                set -l timestamp unknown
                set -l updates
                for row in $cache_lines
                    set -l parts (string split 	 -- "$row")
                    switch "$parts[1]"
                        case count
                            set count "$parts[2]"
                        case timestamp
                            set timestamp "$parts[2]"
                        case update
                            set -a updates "  • $parts[2]: $parts[3] → $parts[4]"
                    end
                end
                
                echo "Available updates: $count"
                echo "Last checked: $timestamp"
                
                if test $count -gt 0
                    echo ""
                    echo "Updates available:"
                    printf "%s\n" $updates
                end
            else
                echo ""
                echo "Cache file not found. Run 'flake_check_updates' to generate it."
            end
            
        case enable
            systemctl --user enable --now flake-update-checker.timer
            echo "Enabled and started flake updates checker timer"
            
        case disable
            systemctl --user disable --now flake-update-checker.timer
            echo "Disabled and stopped flake updates checker timer"
            
        case refresh
            # Regenerate cache and trigger UI refresh
            # This is typically called after a successful system rebuild
            if command -q flake-check-updates
                flake-check-updates ~/nixos >/dev/null 2>&1
            else
                echo "Warning: flake-check-updates command not found"
                return 1
            end
            
            # Update cache metadata with current generation and rebuild timestamp
            if type -q flake_update_cache_metadata
                flake_update_cache_metadata >/dev/null 2>&1
            end
            
            # Trigger AGS start-menu refresh to re-read the updated cache
            if command -q ags
                ags request -i start-menu-daemon '{"action":"refresh"}' >/dev/null 2>&1
                echo "Cache regenerated and UI refreshed"
            else
                echo "Cache regenerated (AGS not available for UI refresh)"
            end
            
        case '*'
            echo "Usage: flake_updates_daemon {start|stop|restart|status|enable|disable|refresh}"
            echo ""
            echo "Commands:"
            echo "  start    - Run the update checker once"
            echo "  stop     - Stop the update checker service"
            echo "  restart  - Restart the update checker service"
            echo "  status   - Show service status and cached updates"
            echo "  enable   - Enable and start the hourly timer"
            echo "  disable  - Disable and stop the hourly timer"
            echo "  refresh  - Regenerate cache and update UI (use after system rebuild)"
            return 1
    end
end

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
            set cache_file "$HOME/.cache/flake-updates.json"
            if test -f $cache_file
                echo ""
                echo "=== Cache Contents ==="
                set count (jq -r '.count' $cache_file 2>/dev/null)
                set timestamp (jq -r '.timestamp // "unknown"' $cache_file 2>/dev/null)
                
                echo "Available updates: $count"
                echo "Last checked: $timestamp"
                
                if test $count -gt 0
                    echo ""
                    echo "Updates available:"
                    jq -r '.updates[] | "  • \(.name): \(.currentShort) → \(.newShort)"' $cache_file 2>/dev/null
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
            systemctl --user start flake-update-checker.service 2>/dev/null
            
            # Wait for service to complete (max 30 seconds)
            set -l timeout 30
            set -l elapsed 0
            while systemctl --user is-active flake-update-checker.service >/dev/null 2>&1
                sleep 0.5
                set elapsed (math $elapsed + 0.5)
                if test $elapsed -ge $timeout
                    echo "Warning: Cache refresh timed out after 30 seconds"
                    break
                end
            end
            
            # Update cache metadata with current generation and rebuild timestamp
            if command -q flake_update_cache_metadata
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

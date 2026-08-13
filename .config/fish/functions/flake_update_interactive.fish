function flake_update_interactive --description 'Interactively update Nix flake inputs'
    # -r/--rebuild: Prompt to rebuild NixOS after a successful update
    # -c/--cache: Accept cache entries regardless of age when listed inputs still match the lock
    # -f/--force: Refresh the shared update-watcher cache before displaying updates
    # -n/--notify: Send a desktop notification after a rebuild
    argparse r/rebuild c/cache f/force n/notify -- $argv
    or return

    set -l flake_path $argv[1]
    if test -z "$flake_path"
        set flake_path ~/nixos
    end

    if not test -f "$flake_path/flake.lock"
        gum style --foreground 1 "No flake.lock found in $flake_path"
        return 1
    end

    set -l cache_ttl_seconds 600
    if set -q _flag_cache
        set cache_ttl_seconds 315360000
    end

    set -l should_refresh false
    if set -q _flag_force
        set should_refresh true
    end

    set -l selected_inputs
    while true
        set -l cache_json
        if test $should_refresh = false
            set cache_json (bun --cwd ~/.config/fish/libexec nix/flake_update_cache.ts read --flake "$flake_path" --max-age-seconds $cache_ttl_seconds)
        end

        if test $should_refresh = true -o $status -ne 0
            gum spin --spinner pulse --title "Checking for outdated inputs..." -- flake-check-updates "$flake_path"
            or begin
                gum style --foreground 1 "Failed to check flake updates"
                return 1
            end

            set cache_json (bun --cwd ~/.config/fish/libexec nix/flake_update_cache.ts read --flake "$flake_path" --max-age-seconds 60)
            or begin
                gum style --foreground 1 "Update checker did not produce a valid cache"
                return 1
            end
        end

        set -l update_count (string match -r '"count":([0-9]+)' -- "$cache_json")[2]
        if test "$update_count" = 0
            gum style --foreground 2 "All flake inputs are up to date!"
            return 0
        end

        set -l selected_json (env FLAKE_PATH="$flake_path" FLAKE_UPDATE_CACHE="$cache_json" bun --cwd ~/.config/fish/libexec nix/flake_update_picker.ts)
        if test $status -ne 0 -o -z "$selected_json"
            gum style --foreground 3 "No inputs selected for update"
            return 0
        end

        if test "$selected_json" = '["__refresh__"]'
            set should_refresh true
            continue
        end

        set selected_inputs (printf '%s' "$selected_json" | jq -r '.[]')
        if test (count $selected_inputs) -eq 0
            gum style --foreground 3 "No inputs selected for update"
            return 0
        end

        break
    end

    if not gum confirm "Update selected flake inputs?"
        gum style --foreground 3 "Update cancelled"
        return 0
    end

    set -l flake_lock_backup (mktemp)
    cp "$flake_path/flake.lock" "$flake_lock_backup"
    or return 1

    pushd "$flake_path"
    gum spin --spinner pulse --title "Updating flake inputs..." -- nix flake update $selected_inputs
    set -l update_status $status
    popd

    if test $update_status -ne 0
        rm -f "$flake_lock_backup"
        gum style --foreground 1 "Failed to update selected flake inputs"
        return 1
    end

    gum style --foreground 2 "Flake inputs updated successfully!"

    if not set -q _flag_rebuild
        rm -f "$flake_lock_backup"
        return 0
    end

    if not gum confirm "Rebuild NixOS configuration now?"
        rm -f "$flake_lock_backup"
        gum style --foreground 3 "Rebuild skipped. Run 'nxrb' when ready."
        return 0
    end

    __flake_update_rebuild "$flake_path"
    set -l rebuild_status $status

    if test $rebuild_status -eq 0
        rm -f "$flake_lock_backup"
        gum style --foreground 2 "System rebuilt successfully!"
        gum spin --spinner pulse --title "Refreshing update cache..." -- flake-check-updates "$flake_path"
        if set -q _flag_notify
            __flake_update_notify normal "NixOS Update Complete" "System has been successfully rebuilt and switched."
        end
        return 0
    end

    cp "$flake_lock_backup" "$flake_path/flake.lock"
    rm -f "$flake_lock_backup"
    gum style --foreground 1 "System rebuild failed; restored flake.lock to its pre-update state"
    if set -q _flag_notify
        __flake_update_notify critical "NixOS Update Failed" "The system update encountered an error. Check the terminal output for details."
    end
    return 1
end

function __flake_update_rebuild --argument-names flake_path
    if not isatty stdout; or test "$TERM" = dumb
        __flake_update_rebuild_command "$flake_path"
        return $status
    end

    if not command -q nh
        sudo -v
        or return
    end

    set -l rebuild_log (mktemp)
    __flake_update_rebuild_command "$flake_path" >"$rebuild_log" 2>&1 &
    set -l rebuild_pid $last_pid
    set -l started_at (date +%s)
    set -l frame 0
    set -l columns (tput cols 2>/dev/null)
    if test -z "$columns"
        set columns 80
    end

    gum style --align center --width "$columns" --foreground 6 --bold ""
    gum style --align center --width "$columns" --bold "Preparing NixOS configuration"
    printf "\n"

    while kill -0 "$rebuild_pid" 2>/dev/null
        set -l now (date +%s)
        set -l elapsed_seconds (math "$now - $started_at")
        set -l elapsed_minutes (math "floor($elapsed_seconds / 60)")
        set -l elapsed_remainder (math "$elapsed_seconds % 60")
        set -l elapsed "$elapsed_minutes"m" "$elapsed_remainder"s elapsed"
        set -l position (math "$frame % 30")
        set -l leading (string repeat -n "$position" "─")
        set -l trailing (string repeat -n (math "29 - $position") "─")
        set -l progress "[$leading●$trailing]"

        if test $frame -gt 0
            printf "\033[2A"
        end
        gum style --align center --width "$columns" --foreground 6 "$progress"
        gum style --align center --width "$columns" --dim "Building and activating... $elapsed"

        set frame (math "$frame + 1")
        sleep 0.12
    end

    wait "$rebuild_pid"
    set -l rebuild_status $status
    printf "\033[2A\r\033[2K\n\r\033[2K"

    if test $rebuild_status -ne 0
        string collect <"$rebuild_log" >&2
    end
    rm -f "$rebuild_log"
    return $rebuild_status
end

function __flake_update_rebuild_command --argument-names flake_path
    if command -q nh
        nh os switch "$flake_path"
        return $status
    end

    sudo nixos-rebuild switch --flake "$flake_path#"(hostname)
end

function __flake_update_notify --argument-names urgency title body
    if command -q notify-send
        notify-send --app-name="NixOS Update" --urgency="$urgency" "$title" "$body"
    else if command -q dunstify
        dunstify --appname="NixOS Update" --urgency="$urgency" "$title" "$body"
    end
end

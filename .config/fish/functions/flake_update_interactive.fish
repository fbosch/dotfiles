function flake_update_interactive --description 'Interactively update Nix flake inputs'
    # -r/--rebuild: Prompt to rebuild NixOS after a successful update
    # -c/--cache: Accept cache entries regardless of age when the lock still matches
    # -f/--force: Refresh the shared update-watcher cache before displaying updates
    # -h/--header: Show flake and current-generation details
    # -n/--notify: Send a desktop notification after a rebuild
    argparse r/rebuild c/cache f/force h/header n/notify -- $argv
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

    if set -q _flag_header
        __flake_update_header "$flake_path"
    end

    set -l cache_output
    if not set -q _flag_force
        set cache_output (bun --cwd ~/.config/fish/libexec nix/flake_update_cache.ts read --flake "$flake_path" --max-age-seconds $cache_ttl_seconds)
    end

    if test $status -ne 0
        if set -q _flag_force
            gum style --foreground 3 "Refreshing update cache (--force)..."
        else
            gum style --foreground 4 "Refreshing update cache..."
        end

        gum spin --spinner pulse --title "Checking for outdated inputs..." -- flake-check-updates "$flake_path"
        or begin
            gum style --foreground 1 "Failed to check flake updates"
            return 1
        end

        set cache_output (bun --cwd ~/.config/fish/libexec nix/flake_update_cache.ts read --flake "$flake_path" --max-age-seconds 60 --allow-unidentified-fresh-cache)
        or begin
            gum style --foreground 1 "Update checker did not produce a valid cache"
            return 1
        end
    end

    set -l input_options
    set -l cache_timestamp
    for line in $cache_output
        set -l fields (string split -m 1 \t -- "$line")
        switch $fields[1]
            case cache
                set cache_timestamp $fields[2]
            case update
                set input_options $input_options $fields[2]
        end
    end

    if test -n "$cache_timestamp"
        gum style --foreground 6 "Using update cache (checked: $cache_timestamp)"
    end

    if test (count $input_options) -eq 0
        gum style --foreground 2 "All flake inputs are up to date!"
        return 0
    end

    set -l selected_options (printf '%s\n' $input_options | gum choose --no-limit --header="Select flake inputs to update (Space to select, Enter to confirm)")
    if test -z "$selected_options"
        gum style --foreground 3 "No inputs selected for update"
        return 0
    end

    set -l selected_inputs
    for option in $selected_options
        set -l input_name (string split -m 1 ':' -- "$option")[1]
        if string length -q "$input_name"
            set selected_inputs $selected_inputs $input_name
        end
    end

    if test (count $selected_inputs) -eq 0
        gum style --foreground 3 "No valid inputs extracted from selection"
        return 0
    end

    gum style --foreground 4 "Selected inputs to update:"
    printf '  %s\n' $selected_options

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

    gum style --foreground 4 "Starting system rebuild..."
    if command -q nh
        nh os switch "$flake_path"
    else
        sudo nixos-rebuild switch --flake "$flake_path#"(hostname)
    end
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

function __flake_update_header --argument-names flake_path
    gum style --foreground 6 --bold '  Flake Updater'
    gum style --foreground 8 "  Path: $flake_path"
    gum style --foreground 8 "  Host: "(hostname)

    set -l system_profile /nix/var/nix/profiles/system
    if not test -L "$system_profile"
        return
    end

    set -l generation (basename (readlink "$system_profile") | string replace 'system-' '' | string replace -- '-link' '')
    set -l timestamp (stat -c %Y "$system_profile" 2>/dev/null)
    if test -n "$timestamp" -a -n "$generation"
        set -l time_ago (__time_ago_from_timestamp "$timestamp")
        gum style --foreground 8 "  Generation: $generation (rebuilt $time_ago)"
    end
end

function __flake_update_notify --argument-names urgency title body
    if command -q notify-send
        notify-send --app-name="NixOS Update" --urgency="$urgency" "$title" "$body"
    else if command -q dunstify
        dunstify --appname="NixOS Update" --urgency="$urgency" "$title" "$body"
    end
end

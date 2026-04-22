function flake_update_interactive --description 'Interactively update nix flake inputs using nix commands and gum (pnpm-style)'
    argparse r/rebuild c/cache f/force h/header n/notify -- $argv
    or return

    set -l flake_path $argv[1]
    if test -z "$flake_path"
        set flake_path ~/nixos
    end

    if set -q _flag_header
        set -l host_name (hostname)

        gum style --foreground 6 --bold '
  ╔═════════════════════╗
  ║    Flake Updater   ║
  ╚═════════════════════╝
        '
        gum style --foreground 8 "  Path: $flake_path"
        gum style --foreground 8 "  Host: $host_name"

        set system_profile /nix/var/nix/profiles/system
        if test -L "$system_profile"
            set generation (basename (readlink $system_profile) | string replace 'system-' '' | string replace -- '-link' '')

            set timestamp ""
            if test (uname) = Linux
                set timestamp (stat -c %Y $system_profile 2>/dev/null)
            else if test (uname) = Darwin
                set timestamp (stat -f %m $system_profile 2>/dev/null)
            end

            if test -n "$timestamp" -a -n "$generation"
                set time_ago (__time_ago_from_timestamp "$timestamp")
                if test -n "$time_ago"
                    gum style --foreground 8 "  Generation: $generation (rebuilt $time_ago)"
                else
                    gum style --foreground 8 "  Generation: $generation"
                end
            end
        end

        echo ""
    end

    if not test -f "$flake_path/flake.lock"
        gum style --foreground 1 "No flake.lock found in $flake_path"
        return 1
    end

    if not command -q bun
        gum style --foreground 1 "bun is required"
        return 1
    end

    set -l helper_dir (path dirname (status filename))
    set -l fish_root (path resolve "$helper_dir/..")
    set -l libexec_dir "$fish_root/libexec"
    set -l helper "nix/update_engine.ts"
    if not test -f "$libexec_dir/$helper"
        gum style --foreground 1 "flake_update_interactive: helper not found: $libexec_dir/$helper"
        return 1
    end

    set -l cache_ttl_seconds 600
    if set -q _flag_cache
        set cache_ttl_seconds 315360000
    end

    set -l force 0
    if set -q _flag_force
        set force 1
        gum style --foreground 3 "Bypassing cache (--force), checking updates manually..."
    end

    set -l scan_lines (FLAKE_UPDATE_CACHE_TTL_SECONDS="$cache_ttl_seconds" FLAKE_UPDATE_BATCH_SIZE="3" FLAKE_UPDATE_TIMEOUT_MS="8000" FLAKE_UPDATE_FORCE="$force" bun --smol --cwd "$libexec_dir" --install=auto "$helper" lines "$flake_path")
    if test $status -ne 0
        gum style --foreground 1 "Failed to check flake updates"
        return 1
    end

    set -l update_count 0
    set -l partial_scan false
    set -l scanned_count 0
    set -l total_inputs 0
    set -l source live
    set -l timestamp ""
    set -l input_options

    for row in $scan_lines
        set -l parts (string split 	 -- "$row")
        switch "$parts[1]"
            case count
                set update_count "$parts[2]"
            case partial
                set partial_scan "$parts[2]"
            case scannedCount
                set scanned_count "$parts[2]"
            case totalInputs
                set total_inputs "$parts[2]"
            case source
                set source "$parts[2]"
            case timestamp
                set timestamp "$parts[2]"
            case update
                set -a input_options "$parts[2]: $parts[3] → $parts[4]"
        end
    end

    if test "$update_count" -eq 0 -a "$partial_scan" = true
        gum style --foreground 6 "No updates found in this batch ($scanned_count/$total_inputs inputs scanned)"
        gum style --foreground 8 "Run again to scan the next batch, or use --force after cache expiry for a full refresh cycle."
        return 0
    end

    if test "$update_count" -eq 0
        if test "$source" = cache
            gum style --foreground 2 "Cache shows all flake inputs are up to date!"
        else
            gum style --foreground 2 "All flake inputs are up to date!"
        end
        return 0
    end

    if test "$source" = cache
        if test -n "$timestamp"
            gum style --foreground 6 "Using cached updates (checked: $timestamp)"
        else
            gum style --foreground 6 "Using cached updates"
        end
    end

    if test -z "$input_options"
        gum style --foreground 2 "All flake inputs are up to date!"
        return 0
    end

    set -l options_text (string join \n $input_options)
    set -l selected_options (printf "%s\n" $options_text | gum choose --no-limit --header="Select flake inputs to update (Space to select, Enter to confirm)")

    if test -z "$selected_options"
        gum style --foreground 3 "No inputs selected for update"
        return 0
    end

    set -l selected_inputs
    for option in $selected_options
        set -l input_name (string split -m 1 ":" $option)[1]
        if string length -q "$input_name"
            set selected_inputs $selected_inputs $input_name
        end
    end

    if test -z "$selected_inputs"
        gum style --foreground 3 "No valid inputs extracted from selection"
        return 0
    end

    set -l summary_lines
    for input in $selected_inputs
        for option in $input_options
            if string match -q "$input:*" $option
                set summary_lines $summary_lines "  $option"
                break
            end
        end
    end

    gum style --foreground 4 "Selected inputs to update:"
    printf "%s\n" $summary_lines

    if not gum confirm "Update selected flake inputs?"
        gum style --foreground 3 "Update cancelled"
        return 0
    end

    pushd $flake_path

    set -l flake_lock_backup (mktemp)
    cp flake.lock $flake_lock_backup

    gum spin --spinner pulse --title "Updating flake inputs..." -- nix flake update $selected_inputs
    set update_status $status
    popd

    if test $update_status -eq 0
        gum style --foreground 2 "✓ Flake inputs updated successfully!"

        if set -q _flag_rebuild
            echo ""
            if gum confirm "Rebuild NixOS configuration now?"
                gum style --foreground 4 "Starting system rebuild..."
                if command -q nh
                    nh os switch ~/nixos
                else
                    set -l host (hostname)
                    sudo nixos-rebuild switch --flake ~/nixos\#$host
                end
                set rebuild_status $status

                if test $rebuild_status -eq 0
                    gum style --foreground 2 "✓ System rebuilt successfully!"
                    rm -f $flake_lock_backup

                    if type -q flake_updates_daemon
                        gum spin --spinner pulse --title "Refreshing update cache..." -- flake_updates_daemon refresh
                    else if command -q flake-check-updates
                        gum spin --spinner pulse --title "Refreshing update cache..." -- flake-check-updates ~/nixos
                    end

                    if set -q _flag_notify
                        set -l icon_path (mktemp --suffix=.svg)
                        ~/.config/hypr/scripts/nerd-icon-gen.sh "󰗡" 64 "#4ade80" "$icon_path" >/dev/null 2>&1

                        if command -q notify-send
                            notify-send --app-name="NixOS Update" --icon="$icon_path" --urgency=normal "NixOS Update Complete" "System has been successfully rebuilt and switched. A restart may be required for some changes."
                        end

                        fish -c "sleep 5; rm -f '$icon_path'" &
                    end
                else
                    gum style --foreground 1 "✗ System rebuild failed"

                    if test -f "$flake_lock_backup"
                        pushd $flake_path
                        cp $flake_lock_backup flake.lock
                        popd
                        rm -f $flake_lock_backup
                        gum style --foreground 3 "ℹ Restored flake.lock to pre-update state"
                    end

                    if set -q _flag_notify
                        set -l icon_path (mktemp --suffix=.svg)
                        ~/.config/hypr/scripts/nerd-icon-gen.sh "" 64 "#ef4444" "$icon_path" >/dev/null 2>&1

                        if command -q notify-send
                            notify-send --app-name="NixOS Update" --icon="$icon_path" --urgency=critical "NixOS Update Failed" "The system update encountered an error. Please check the terminal output for details."
                        else if command -q dunstify
                            dunstify --appname="NixOS Update" --icon="$icon_path" --urgency=critical "NixOS Update Failed" "The system update encountered an error. Please check the terminal output for details."
                        end

                        fish -c "sleep 5; rm -f '$icon_path'" &
                    end

                    return 1
                end
            else
                gum style --foreground 3 "Rebuild skipped. Run 'nxrb' when ready."
                rm -f $flake_lock_backup
            end
        else
            rm -f $flake_lock_backup
        end
    else
        gum style --foreground 1 "✗ Failed to update some flake inputs"
        rm -f $flake_lock_backup
        return 1
    end
end

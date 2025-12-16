function flake_update_interactive --description 'Interactively update nix flake inputs using nix commands and gum (pnpm-style)'
    # Parse arguments
    # -r/--rebuild: Prompt to rebuild NixOS after successful update
    # -c/--cache: Read available updates from cache file instead of checking
    # -h/--header: Show decorative ASCII header with flake info
    # -n/--notify: Send desktop notification after successful rebuild
    argparse r/rebuild c/cache h/header n/notify -- $argv
    or return

    # Default to ~/nixos if no path provided
    set flake_path $argv[1]
    if test -z "$flake_path"
        set flake_path ~/nixos
    end

    # Show ASCII header if requested
    if set -q _flag_header
        # Get hostname for display
        set host_name (hostname)

        gum style --foreground 6 --bold '
  ╔═════════════════════╗
  ║    Flake Updater   ║
  ╚═════════════════════╝
        '
        gum style --foreground 8 "  Path: $flake_path"
        gum style --foreground 8 "  Host: $host_name"

        # Show current NixOS generation and last rebuild time
        set system_profile /nix/var/nix/profiles/system
        if test -L "$system_profile"
            # Get generation number from symlink name (format: system-123-link)
            set generation (basename (readlink $system_profile) | string replace 'system-' '' | string replace -- '-link' '')
            
            # Get timestamp of last rebuild (stat format differs by OS)
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

    # Check if flake.lock exists
    if not test -f "$flake_path/flake.lock"
        gum style --foreground 1 "No flake.lock found in $flake_path"
        return 1
    end

    # If --cache flag is set, try to read from cache file
    set input_options
    if set -q _flag_cache
        set cache_file "$XDG_CACHE_HOME/flake-updates.json"
        if test -z "$XDG_CACHE_HOME"
            set cache_file ~/.cache/flake-updates.json
        end

        if test -f "$cache_file"
            # Read cache and parse updates
            set update_count (jq -r '.count // 0' $cache_file 2>/dev/null)

            # Ensure update_count is a valid number
            if test -z "$update_count"
                set update_count 0
            end

            if test "$update_count" -gt 0
                # Extract updates from cache into input_options format
                for update in (jq -r '.updates[] | @json' $cache_file 2>/dev/null)
                    set name (echo $update | jq -r '.name' 2>/dev/null)
                    set current_short (echo $update | jq -r '.currentShort' 2>/dev/null)
                    set new_short (echo $update | jq -r '.newShort' 2>/dev/null)

                    if test -n "$name" -a -n "$current_short" -a -n "$new_short"
                        set formatted_option "$name: $current_short → $new_short"
                        set input_options $input_options $formatted_option
                    end
                end

                # Show cache timestamp
                set timestamp (jq -r '.timestamp // ""' $cache_file 2>/dev/null)
                if test -n "$timestamp"
                    gum style --foreground 6 "Using cached updates (checked: $timestamp)"
                else
                    gum style --foreground 6 "Using cached updates"
                end
            else
                gum style --foreground 2 "Cache shows all flake inputs are up to date!"
                return 0
            end
        else
            gum style --foreground 3 "No cache file found, checking updates manually..."
            # Fall through to manual check
        end
    end

    # Only check for updates if we didn't get them from cache
    if test (count $input_options) -eq 0

        # Change to flake directory
        pushd $flake_path

        # Get all inputs from flake metadata
        set flake_data (jq '.' flake.lock 2>/dev/null)
        set root_inputs (echo $flake_data | jq -r '.nodes.root.inputs' 2>/dev/null)

        if test $status -ne 0 || test -z "$root_inputs"
            gum style --foreground 1 "Failed to get flake inputs"
            popd
            return 1
        end

        set input_list (echo $root_inputs | jq -r 'keys[]' 2>/dev/null)

        if test $status -ne 0
            gum style --foreground 1 "Failed to parse flake inputs"
            popd
            return 1
        end

        # Check each input for available updates by actually trying to update it
        # We'll backup and restore the lock file for each check
        set total (count $input_list)
        set lock_backup (mktemp)
        cp flake.lock $lock_backup

        # Show message and run the check loop
        gum style --foreground 4 "Checking for outdated inputs..."

        for input in $input_list
            # Restore original lock file before each check
            cp $lock_backup flake.lock

            # Get current revision from lock file
            set node_name (echo $root_inputs | jq -r ".[\"$input\"]" 2>/dev/null)
            if test $status -ne 0 -o -z "$node_name" -o "$node_name" = null
                continue
            end

            set node_data (echo $flake_data | jq ".nodes.\"$node_name\"" 2>/dev/null)
            if test $status -ne 0 -o -z "$node_data" -o "$node_data" = null
                continue
            end

            set current_rev (echo $node_data | jq -r '.locked.rev // empty' 2>/dev/null)
            if test -z "$current_rev" -o "$current_rev" = null
                continue
            end

            # Try to update this input (suppress output to keep it clean)
            nix flake update --update-input $input >/dev/null 2>&1

            # Check if the lock file changed by comparing the revision
            set updated_flake_data (jq '.' flake.lock 2>/dev/null)
            set updated_node_data (echo $updated_flake_data | jq ".nodes.\"$node_name\"" 2>/dev/null)
            if test $status -eq 0 -a -n "$updated_node_data" -a "$updated_node_data" != null
                set new_rev (echo $updated_node_data | jq -r '.locked.rev // empty' 2>/dev/null)

                if test -n "$new_rev" -a "$new_rev" != null -a "$new_rev" != "$current_rev"
                    set current_short (string sub -l 7 $current_rev)
                    set new_short (string sub -l 7 $new_rev)

                    # Simple format: "input-name: current → new"
                    set formatted_option "$input: $current_short → $new_short"
                    set input_options $input_options $formatted_option
                end
            end
        end

        # Restore original lock file
        cp $lock_backup flake.lock
        rm -f $lock_backup

        popd

        # Write results to cache file for future --cache invocations
        set cache_file "$XDG_CACHE_HOME/flake-updates.json"
        if test -z "$XDG_CACHE_HOME"
            set cache_file ~/.cache/flake-updates.json
        end

        # Ensure cache directory exists
        mkdir -p (dirname $cache_file)

        # Build JSON cache data
        set update_count (count $input_options)
        set timestamp (date -Iseconds)
        
        if test $update_count -gt 0
            # Build updates array
            set updates_json "["
            set first true
            for option in $input_options
                # Parse: "name: current → new"
                set parts (string split ": " $option)
                set name $parts[1]
                set versions (string split " → " $parts[2])
                set current_short $versions[1]
                set new_short $versions[2]
                
                if test "$first" = true
                    set first false
                else
                    set updates_json "$updates_json,"
                end
                
                set updates_json "$updates_json{\"name\":\"$name\",\"currentShort\":\"$current_short\",\"newShort\":\"$new_short\"}"
            end
            set updates_json "$updates_json]"
            
            # Write complete JSON to cache
            echo "{\"timestamp\":\"$timestamp\",\"count\":$update_count,\"updates\":$updates_json}" >$cache_file
        else
            # No updates available
            echo "{\"timestamp\":\"$timestamp\",\"count\":0,\"updates\":[]}" >$cache_file
        end
    end # End of manual update check

    if test -z "$input_options"
        gum style --foreground 2 "All flake inputs are up to date!"
        return 0
    end

    # Show interactive selection (pnpm-style)
    # Join all options with newlines to ensure they're all ready before passing to gum
    set options_text (string join \n $input_options)

    # Pass all options at once to gum to avoid pop-in effect
    set selected_options (printf "%s\n" $options_text | gum choose --no-limit --header="Select flake inputs to update (Space to select, Enter to confirm)")

    if test -z "$selected_options"
        gum style --foreground 3 "No inputs selected for update"
        return 0
    end

    # Extract input names from selected options
    # Format: "input-name: current → new"
    set selected_inputs
    for option in $selected_options
        # Extract input name - everything before the colon
        set input_name (string split -m 1 ":" $option)[1]
        if string length -q "$input_name"
            set selected_inputs $selected_inputs $input_name
        end
    end

    if test -z "$selected_inputs"
        gum style --foreground 3 "No valid inputs extracted from selection"
        return 0
    end

    # Show summary of what will be updated (build all at once to avoid pop-in)
    set summary_lines
    for input in $selected_inputs
        # Get the formatted option for this input to show the full update info
        for option in $input_options
            if string match -q "$input:*" $option
                set summary_lines $summary_lines "  $option"
                break
            end
        end
    end

    # Display header and all items at once
    gum style --foreground 4 "Selected inputs to update:"
    printf "%s\n" $summary_lines

    # Confirm update
    if not gum confirm "Update selected flake inputs?"
        gum style --foreground 3 "Update cancelled"
        return 0
    end

    # Update selected inputs
    pushd $flake_path
    gum spin --spinner pulse --title "Updating flake inputs..." -- nix flake update $selected_inputs
    set update_status $status
    popd

    if test $update_status -eq 0
        gum style --foreground 2 "✓ Flake inputs updated successfully!"

        # Prompt for rebuild if --rebuild flag was passed
        if set -q _flag_rebuild
            echo "" # Blank line for spacing
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

                    # Regenerate update cache and trigger start-menu refresh
                    if command -q flake_updates_daemon
                        flake_updates_daemon refresh >/dev/null 2>&1 &
                    end

                    # Send desktop notification if --notify flag was passed
                    if set -q _flag_notify
                        # Generate custom icon using nerd-icon-gen.sh
                        set icon_path (mktemp --suffix=.svg)
                        ~/.config/hypr/scripts/nerd-icon-gen.sh "󰗡" 64 "#4ade80" "$icon_path" >/dev/null 2>&1

                        if command -q notify-send
                            notify-send \
                                --app-name="NixOS Update" \
                                --icon="$icon_path" \
                                --urgency=normal \
                                "NixOS Update Complete" \
                                "System has been successfully rebuilt and switched. A restart may be required for some changes."
                        end

                        # Clean up temp icon file after a short delay
                        fish -c "sleep 5; rm -f '$icon_path'" &
                    end
                else
                    gum style --foreground 1 "✗ System rebuild failed"

                    # Send failure notification if --notify flag was passed
                    if set -q _flag_notify
                        # Generate custom icon using nerd-icon-gen.sh (red for error)
                        set icon_path (mktemp --suffix=.svg)
                        ~/.config/hypr/scripts/nerd-icon-gen.sh "" 64 "#ef4444" "$icon_path" >/dev/null 2>&1

                        if command -q notify-send
                            notify-send \
                                --app-name="NixOS Update" \
                                --icon="$icon_path" \
                                --urgency=critical \
                                "NixOS Update Failed" \
                                "The system update encountered an error. Please check the terminal output for details."
                        else if command -q dunstify
                            dunstify \
                                --appname="NixOS Update" \
                                --icon="$icon_path" \
                                --urgency=critical \
                                "NixOS Update Failed" \
                                "The system update encountered an error. Please check the terminal output for details."
                        end

                        # Clean up temp icon file after a short delay
                        fish -c "sleep 5; rm -f '$icon_path'" &
                    end

                    return 1
                end
            else
                gum style --foreground 3 "Rebuild skipped. Run 'nxrb' when ready."
            end
        end
    else
        gum style --foreground 1 "✗ Failed to update some flake inputs"
        return 1
    end
end

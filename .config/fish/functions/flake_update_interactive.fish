function flake_update_interactive --description 'Interactively update nix flake inputs using nix commands and gum (pnpm-style)'
    # Default to ~/nixos if no path provided
    set flake_path $argv[1]
    if test -z "$flake_path"
        set flake_path ~/nixos
    end

    # Check if flake.lock exists
    if not test -f "$flake_path/flake.lock"
        gum style --foreground 1 "No flake.lock found in $flake_path"
        return 1
    end

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
    set input_options
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
        if test $status -ne 0 -o -z "$node_name" -o "$node_name" = "null"
            continue
        end

        set node_data (echo $flake_data | jq ".nodes.\"$node_name\"" 2>/dev/null)
        if test $status -ne 0 -o -z "$node_data" -o "$node_data" = "null"
            continue
        end

        set current_rev (echo $node_data | jq -r '.locked.rev // empty' 2>/dev/null)
        if test -z "$current_rev" -o "$current_rev" = "null"
            continue
        end

        # Try to update this input (suppress output to keep it clean)
        nix flake update --update-input $input >/dev/null 2>&1
        
        # Check if the lock file changed by comparing the revision
        set updated_flake_data (jq '.' flake.lock 2>/dev/null)
        set updated_node_data (echo $updated_flake_data | jq ".nodes.\"$node_name\"" 2>/dev/null)
        if test $status -eq 0 -a -n "$updated_node_data" -a "$updated_node_data" != "null"
            set new_rev (echo $updated_node_data | jq -r '.locked.rev // empty' 2>/dev/null)
            
            if test -n "$new_rev" -a "$new_rev" != "null" -a "$new_rev" != "$current_rev"
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
    else
        gum style --foreground 1 "✗ Failed to update some flake inputs"
        return 1
    end
end

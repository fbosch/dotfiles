function flake_check_updates --description 'Check for available flake updates and return JSON with details'
    # Default to ~/nixos if no path provided
    set flake_path $argv[1]
    if test -z "$flake_path"
        set flake_path ~/nixos
    end

    # Check if flake.lock exists
    if not test -f "$flake_path/flake.lock"
        echo '{"count": 0, "updates": []}'
        return 1
    end

    # Change to flake directory
    pushd $flake_path >/dev/null 2>&1

    # Get all inputs from flake metadata
    set flake_data (jq '.' flake.lock 2>/dev/null)
    set root_inputs (echo $flake_data | jq -r '.nodes.root.inputs' 2>/dev/null)

    if test $status -ne 0 || test -z "$root_inputs"
        echo '{"count": 0, "updates": []}'
        popd >/dev/null 2>&1
        return 1
    end

    set input_list (echo $root_inputs | jq -r 'keys[]' 2>/dev/null)
    
    if test $status -ne 0
        echo '{"count": 0, "updates": []}'
        popd >/dev/null 2>&1
        return 1
    end

    # Check each input for available updates
    set updates_json "[]"
    set lock_backup (mktemp)
    cp flake.lock $lock_backup

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

        # Try to update this input (completely silent)
        nix flake update --update-input $input >/dev/null 2>&1
        
        # Check if the lock file changed by comparing the revision
        set updated_flake_data (jq '.' flake.lock 2>/dev/null)
        set updated_node_data (echo $updated_flake_data | jq ".nodes.\"$node_name\"" 2>/dev/null)
        if test $status -eq 0 -a -n "$updated_node_data" -a "$updated_node_data" != "null"
            set new_rev (echo $updated_node_data | jq -r '.locked.rev // empty' 2>/dev/null)
            
            if test -n "$new_rev" -a "$new_rev" != "null" -a "$new_rev" != "$current_rev"
                # Get short versions for display
                set current_short (string sub -l 7 $current_rev)
                set new_short (string sub -l 7 $new_rev)
                
                # Add update info to JSON array
                set update_obj (jq -n \
                    --arg name "$input" \
                    --arg currentRev "$current_rev" \
                    --arg currentShort "$current_short" \
                    --arg newRev "$new_rev" \
                    --arg newShort "$new_short" \
                    '{name: $name, currentRev: $currentRev, currentShort: $currentShort, newRev: $newRev, newShort: $newShort}')
                
                set updates_json (echo $updates_json | jq --argjson item "$update_obj" '. += [$item]')
            end
        end
    end

    # Restore original lock file
    cp $lock_backup flake.lock
    rm -f $lock_backup

    popd >/dev/null 2>&1

    # Build final JSON output
    set update_count (echo $updates_json | jq 'length')
    set result (jq -n \
        --argjson count "$update_count" \
        --argjson updates "$updates_json" \
        '{count: $count, updates: $updates}')
    
    echo $result
    return 0
end

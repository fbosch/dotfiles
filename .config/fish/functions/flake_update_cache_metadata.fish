function flake_update_cache_metadata --description 'Update cache metadata with current generation and rebuild timestamp'
    # Determine cache file path
    set cache_file "$XDG_CACHE_HOME/flake-updates.json"
    if test -z "$XDG_CACHE_HOME"
        set cache_file ~/.cache/flake-updates.json
    end
    
    # Get current NixOS generation
    set generation_link (readlink /nix/var/nix/profiles/system 2>/dev/null)
    if test -z "$generation_link"
        echo "Error: Could not read system profile" >&2
        return 1
    end
    
    # Extract generation number from link (e.g., "system-751-link" -> "751")
    set generation (string match -r '\d+' $generation_link)
    if test -z "$generation"
        echo "Error: Could not parse generation number" >&2
        return 1
    end
    
    # Get last rebuild timestamp
    set rebuild_timestamp (stat -c %Y /nix/var/nix/profiles/system 2>/dev/null | xargs -I {} date -d @{} -Iseconds 2>/dev/null)
    if test -z "$rebuild_timestamp"
        echo "Error: Could not get rebuild timestamp" >&2
        return 1
    end
    
    # Update cache file with metadata
    if test -f "$cache_file"
        # Update existing cache with new metadata
        set temp_file (mktemp)
        jq --arg gen "$generation" \
           --arg ts "$rebuild_timestamp" \
           '. + {generation: ($gen | tonumber), lastRebuildTimestamp: $ts}' \
           "$cache_file" > "$temp_file" 2>/dev/null
        
        if test $status -eq 0
            mv "$temp_file" "$cache_file"
        else
            rm -f "$temp_file"
            echo "Error: Failed to update cache metadata" >&2
            return 1
        end
    else
        # Create new cache with just metadata
        jq -n --arg gen "$generation" \
              --arg ts "$rebuild_timestamp" \
              '{count: 0, updates: [], generation: ($gen | tonumber), lastRebuildTimestamp: $ts, timestamp: $ts}' \
              > "$cache_file" 2>/dev/null
        
        if test $status -ne 0
            echo "Error: Failed to create cache file" >&2
            return 1
        end
    end
    
    return 0
end

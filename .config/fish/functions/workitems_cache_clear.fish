function workitems_cache_clear --description 'Clear the work items cache'
    set -l cache_dir ~/.cache/fish/workitems
    
    if test -d "$cache_dir"
        set -l file_count (find "$cache_dir" -type f | wc -l | string trim)
        rm -rf "$cache_dir"
        mkdir -p "$cache_dir"
        gum style --foreground 2 "󰃨 Cleared $file_count cached work item queries"
    else
        gum style --foreground 3 " No cache to clear"
    end
end

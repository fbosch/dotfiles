function flake_get_update_count --description 'Get the cached count of available flake updates'
    set cache_file "$HOME/.cache/flake-updates.json"
    
    if test -f $cache_file
        jq -r '.count // 0' $cache_file 2>/dev/null || echo "0"
    else
        echo "0"
    end
end

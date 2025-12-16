function flake_get_update_details --description 'Get the full JSON of available flake updates'
    set cache_file "$HOME/.cache/flake-updates.json"
    
    if test -f $cache_file
        cat $cache_file
    else
        echo '{"count": 0, "updates": []}'
    end
end

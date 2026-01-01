function mullvad_random_socks5 -d "Get a random Mullvad SOCKS5 proxy address"
    set -l cache_file ~/.cache/mullvad-socks5-proxies.txt
    set -l cache_age_hours 24

    # Fetch and cache proxy list
    function update_cache -V cache_file
        echo "Fetching Mullvad server list..." >&2
        curl -s https://api.mullvad.net/www/relays/all/ \
            | jq -r '.[] | select(.type == "wireguard" and .active == true and .socks_name != null) | .socks_name' \
            > $cache_file
        
        if test $status -eq 0
            echo "Cached "(count (command cat $cache_file))" SOCKS5 proxies" >&2
        else
            echo "Error: Failed to fetch server list" >&2
            return 1
        end
    end

    # Check if cache exists and is fresh
    if test -f $cache_file
        # Get cache age in seconds
        set -l cache_mtime
        switch (uname)
            case Linux
                set cache_mtime (stat -c %Y $cache_file)
            case Darwin
                set cache_mtime (stat -f %m $cache_file)
        end
        
        set -l current_time (date +%s)
        set -l cache_age (math $current_time - $cache_mtime)
        set -l cache_age_in_hours (math $cache_age / 3600)
        
        if test $cache_age_in_hours -gt $cache_age_hours
            echo "Cache is older than $cache_age_hours hours, refreshing..." >&2
            update_cache
        end
    else
        echo "No cache found, fetching server list..." >&2
        update_cache
    end

    # Pick random proxy
    if test -f $cache_file
        set -l proxies (command cat $cache_file)
        set -l proxy_count (count $proxies)
        
        if test $proxy_count -eq 0
            echo "Error: No SOCKS5 proxies found in cache" >&2
            return 1
        end
        
        set -l random_index (random 1 $proxy_count)
        set -l selected_proxy $proxies[$random_index]
        
        # Copy to clipboard
        set -l clipboard_cmd ""
        if test (uname) = Darwin
            set clipboard_cmd pbcopy
        else
            if command -v wl-copy >/dev/null 2>&1
                set clipboard_cmd wl-copy
            else if command -v xclip >/dev/null 2>&1
                set clipboard_cmd "xclip -selection clipboard"
            end
        end

        if test -n "$clipboard_cmd"
            echo -n $selected_proxy | eval $clipboard_cmd
            if test $status -eq 0
                echo "Copied to clipboard: $selected_proxy" >&2
            else
                echo "Failed to copy to clipboard" >&2
            end
        else
            echo "Clipboard command not found" >&2
            echo $selected_proxy
        end
    else
        echo "Error: Cache file not found" >&2
        return 1
    end
end

function __codex_reset_cache_get --argument-names account_id --description "Read fresh reset credits from the shared cache"
    if test -z "$account_id"
        return 2
    end

    set -l cache_home "$XDG_CACHE_HOME"
    if test -z "$cache_home"
        set cache_home "$HOME/.cache"
    end
    set -l cache_file "$cache_home/codex-reset/credits.json"
    if not test -r "$cache_file"
        return 1
    end

    set -l now (date +%s)
    jq -ce \
        --arg account_id "$account_id" \
        --argjson now "$now" \
        --argjson ttl 28800 \
        '
            .accounts[$account_id] as $entry |
            select($entry != null and ($entry.fetched_at | type) == "number") |
            select(($now - $entry.fetched_at) < $ttl) |
            $entry.payload |
            select(type == "object")
        ' \
        "$cache_file" 2>/dev/null
end

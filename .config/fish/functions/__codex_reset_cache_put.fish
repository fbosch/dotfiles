function __codex_reset_cache_put --argument-names account_id payload --description "Store reset credits in the shared cache"
    if test -z "$account_id"; or test -z "$payload"
        return 2
    end

    set -l cache_home "$XDG_CACHE_HOME"
    if test -z "$cache_home"
        set cache_home "$HOME/.cache"
    end
    set -l cache_dir "$cache_home/codex-reset"
    set -l cache_file "$cache_dir/credits.json"
    mkdir -p "$cache_dir"; or return 1

    set -l temporary_file (mktemp "$cache_dir/credits.json.XXXXXX"); or return 1
    set -l now (date +%s)
    if test -f "$cache_file"
        jq \
            --arg account_id "$account_id" \
            --argjson payload "$payload" \
            --argjson fetched_at "$now" \
            '
                .version = 1 |
                .accounts = (.accounts // {}) |
                .accounts[$account_id] = {
                    fetched_at: $fetched_at,
                    payload: $payload
                }
            ' \
            "$cache_file" >"$temporary_file"
    else
        jq -n \
            --arg account_id "$account_id" \
            --argjson payload "$payload" \
            --argjson fetched_at "$now" \
            '{
                version: 1,
                accounts: {
                    ($account_id): {
                        fetched_at: $fetched_at,
                        payload: $payload
                    }
                }
            }' >"$temporary_file"
    end
    if test $status -ne 0
        rm -f "$temporary_file"
        return 1
    end

    mv "$temporary_file" "$cache_file"
end

function opencode_auth_switch --description 'Switch active OpenCode provider with generated profile names'
    set -l auth_file "$HOME/.local/share/opencode/auth.json"
    set -l codex_auth_file "$HOME/.codex/auth.json"
    set -l codex_profiles_file "$HOME/.codex/auth-profiles.json"
    set -l codexbar_cache_file "$HOME/.cache/nvim/codexbar/data.json"
    set -l usage_query 'def rem($p): (100 - (($p // 0) | tonumber | floor)) | if . < 0 then 0 elif . > 100 then 100 else . end; .[0] as $root | ($root.usage.primary // null) as $primary | ($root.usage.secondary // null) as $secondary | [($root.provider // "codex"), (if $primary then (rem($primary.usedPercent) | tostring) else "" end), ($primary.resetsAt // ""), (if $secondary then (rem($secondary.usedPercent) | tostring) else "" end), ($secondary.resetsAt // "")] | @tsv'
    set -l usage_bar_width 16
    set -l bg_mode dark

    if set -q COLORFGBG
        set -l bg_token (string split ';' -- "$COLORFGBG")[-1]
        if string match -rq '^[0-9]+$' -- "$bg_token"
            if test "$bg_token" -gt 7
                set bg_mode light
            end
        end
    end

    if not test -f "$auth_file"
        echo "auth file not found: $auth_file"
        return 1
    end

    for cmd in jq gum bun
        if not command -q $cmd
            echo "$cmd is required"
            return 1
        end
    end

    jq -e '.' "$auth_file" >/dev/null 2>&1
    if test $status -ne 0
        echo "failed to parse: $auth_file"
        return 1
    end

    function __opencode_fetch_usage_tsv --argument-names query
        if not command -q codexbar
            return 127
        end

        codexbar usage --source oauth --provider codex --json 2>/dev/null | jq -r "$query" 2>/dev/null
    end

    function __opencode_usage_color --argument-names remaining
        if test "$remaining" -ge 75
            echo 42
        else if test "$remaining" -ge 50
            echo 220
        else if test "$remaining" -ge 25
            echo 208
        else
            echo 196
        end
    end

    function __opencode_format_countdown --argument-names resets_at
        if test -z "$resets_at"
            return 1
        end

        set -l reset_epoch (date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$resets_at" "+%s" 2>/dev/null)
        if test -z "$reset_epoch"
            set reset_epoch (date -u -d "$resets_at" "+%s" 2>/dev/null)
        end
        if not string match -rq '^[0-9]+$' -- "$reset_epoch"
            return 1
        end

        set -l now_epoch (date -u +%s)
        if not string match -rq '^[0-9]+$' -- "$now_epoch"
            return 1
        end

        set -l diff (math "$reset_epoch - $now_epoch")
        if test "$diff" -le 0
            echo "now"
            return 0
        end

        set -l hours (math "floor($diff / 3600)")
        if test "$hours" -lt 1
            set -l mins (math "floor($diff / 60)")
            if test "$mins" -lt 1
                set mins 1
            end
            echo "~"$mins"m"
            return 0
        end

        if test "$hours" -lt 24
            echo "~"$hours"h"
            return 0
        end

        set -l days (math "floor($hours / 24)")
        echo "~"$days"d"
    end

    function __opencode_render_usage --argument-names title usage_tsv bar_width
        set -l usage_parts (string split \t -- "$usage_tsv")
        if test (count $usage_parts) -lt 5
            gum style --foreground 196 "$title usage unavailable (unexpected response)"
            return 1
        end

        set -l usage_provider "$usage_parts[1]"
        set -l primary_remaining "$usage_parts[2]"
        set -l primary_resets_at "$usage_parts[3]"
        set -l secondary_remaining "$usage_parts[4]"
        set -l secondary_resets_at "$usage_parts[5]"

        gum style --foreground 111 --bold "$title usage ($usage_provider)"

        if test -n "$primary_remaining"
            set -l primary_color (__opencode_usage_color "$primary_remaining")
            set -l primary_filled (math "floor(($primary_remaining * $bar_width) / 100)")
            if test "$primary_filled" -lt 1; and test "$primary_remaining" -gt 0
                set primary_filled 1
            end
            if test "$primary_filled" -gt $bar_width
                set primary_filled $bar_width
            end
            set -l primary_empty (math "$bar_width - $primary_filled")
            set -l primary_bar_filled ""
            if test "$primary_filled" -gt 0
                set primary_bar_filled (gum style --foreground "$primary_color" (string repeat -n $primary_filled -- "█"))
            end
            set -l primary_bar_empty ""
            if test "$primary_empty" -gt 0
                set primary_bar_empty (gum style --foreground 240 (string repeat -n $primary_empty -- "░"))
            end
            set -l primary_percent (gum style --foreground "$primary_color" --bold "$primary_remaining%")
            printf '  %-9s [%s%s] %s left\n' "primary" "$primary_bar_filled" "$primary_bar_empty" "$primary_percent"
            if test -n "$primary_resets_at"
                set -l primary_countdown (__opencode_format_countdown "$primary_resets_at")
                if test -n "$primary_countdown"
                    gum style --foreground 244 "            resets: $primary_countdown"
                end
            end
        else
            gum style --foreground 244 "  primary   n/a"
        end

        if test -n "$secondary_remaining"
            set -l secondary_color (__opencode_usage_color "$secondary_remaining")
            set -l secondary_filled (math "floor(($secondary_remaining * $bar_width) / 100)")
            if test "$secondary_filled" -lt 1; and test "$secondary_remaining" -gt 0
                set secondary_filled 1
            end
            if test "$secondary_filled" -gt $bar_width
                set secondary_filled $bar_width
            end
            set -l secondary_empty (math "$bar_width - $secondary_filled")
            set -l secondary_bar_filled ""
            if test "$secondary_filled" -gt 0
                set secondary_bar_filled (gum style --foreground "$secondary_color" (string repeat -n $secondary_filled -- "█"))
            end
            set -l secondary_bar_empty ""
            if test "$secondary_empty" -gt 0
                set secondary_bar_empty (gum style --foreground 240 (string repeat -n $secondary_empty -- "░"))
            end
            set -l secondary_percent (gum style --foreground "$secondary_color" --bold "$secondary_remaining%")
            printf '  %-9s [%s%s] %s left\n' "secondary" "$secondary_bar_filled" "$secondary_bar_empty" "$secondary_percent"
            if test -n "$secondary_resets_at"
                set -l secondary_countdown (__opencode_format_countdown "$secondary_resets_at")
                if test -n "$secondary_countdown"
                    gum style --foreground 244 "            resets: $secondary_countdown"
                end
            end
        end
    end

    set -l helper_dir (path dirname (status filename))
    set -l fish_root (path resolve "$helper_dir/..")
    set -l libexec_dir "$fish_root/libexec"
    set -l helper "$libexec_dir/opencode/auth_switch_helper.ts"
    if not test -f "$helper"
        echo "helper not found: $helper"
        return 1
    end

    set -l current_usage_tsv (__opencode_fetch_usage_tsv "$usage_query")
    set -l current_usage_status $status
    if test $current_usage_status -eq 0; and test -n "$current_usage_tsv"
        __opencode_render_usage "current" "$current_usage_tsv" "$usage_bar_width"
    else if test $current_usage_status -eq 127
        gum style --foreground 196 "current usage unavailable (codexbar not installed)"
    else
        gum style --foreground 196 "current usage unavailable (codexbar parse failed)"
    end

    echo ""

    set -l list_lines (bun --smol --cwd "$libexec_dir" --install=auto "$helper" list "$auth_file" "$bg_mode")
    if test $status -ne 0
        echo "failed to load providers"
        return 1
    end

    if test -z "$list_lines"
        echo "no providers with switchable variants found"
        return 1
    end

    set -l provider_names
    for row in $list_lines
        set -l parts (string split \t -- "$row")
        if test (count $parts) -lt 4
            continue
        end

        if not contains -- "$parts[1]" $provider_names
            set -a provider_names "$parts[1]"
        end
    end

    set -l provider "$provider_names[1]"
    if test (count $provider_names) -gt 1
        set provider (printf "%s\n" $provider_names | gum choose --header="Select provider")
        if test -z "$provider"
            return 0
        end
    end

    set -l profile_labels
    set -l profile_plain_labels
    set -l profile_keys
    for row in $list_lines
        set -l parts (string split \t -- "$row")
        if test (count $parts) -lt 4
            continue
        end

        if test "$parts[1]" != "$provider"
            continue
        end

        set -l key "$parts[2]"
        set -l label "$parts[3]"
        set -l color "$parts[4]"
        set -a profile_keys "$key"
        set -a profile_plain_labels "$label"
        set -a profile_labels (printf '\e[1;38;5;%sm%s\e[0m' "$color" "$label")
    end

    if test (count $profile_keys) -eq 0
        echo "no suffixed duplicate profiles found for provider: $provider"
        return 1
    end

    set -l choices
    for i in (seq (count $profile_labels))
        set choices $choices "$i) $profile_labels[$i]"
    end

    set -l selected (printf "%s\n" $choices | gum choose --header="Select profile to activate")
    if test -z "$selected"
        return 0
    end

    set -l selected_plain (string replace -r '\e\[[0-9;]*m' '' -- "$selected")
    set -l selected_index (string replace -r '^([0-9]+)\).*$' '$1' -- "$selected_plain")
    if test -z "$selected_index"; or test "$selected_index" = "$selected_plain"
        echo "failed to resolve selected profile"
        return 1
    end

    set -l target_key "$profile_keys[$selected_index]"
    if test -z "$target_key"
        echo "failed to resolve selected profile key"
        return 1
    end

    set -l selected_label "$profile_plain_labels[$selected_index]"
    if test -z "$selected_label"
        set selected_label "$target_key"
    end

    set -l codex_status (bun --smol --cwd "$libexec_dir" --install=auto "$helper" apply "$auth_file" "$codex_auth_file" "$codex_profiles_file" "$provider" "$target_key")
    if test $status -ne 0
        echo "failed to apply auth switch"
        return 1
    end

    set -l switched_usage_tsv ""
    set -l switched_usage_error ""

    if string match -q 'codex switched:*' -- "$codex_status"
        set switched_usage_tsv (__opencode_fetch_usage_tsv "$usage_query")
        set -l switched_usage_fetch_status $status
        if test $switched_usage_fetch_status -eq 0; and test -n "$switched_usage_tsv"
            set switched_usage_error ""
        else if test $switched_usage_fetch_status -eq 127
            set switched_usage_error "switched usage unavailable (codexbar not installed)"
            set switched_usage_tsv ""
        else
            set switched_usage_error "switched usage unavailable (codexbar parse failed)"
            set switched_usage_tsv ""
        end
    end

    echo "active provider switched: $provider <= $selected_label"
    echo "$codex_status"
    if test -n "$switched_usage_tsv"
        echo ""
        __opencode_render_usage "switched" "$switched_usage_tsv" "$usage_bar_width"
    else if test -n "$switched_usage_error"
        echo ""
        gum style --foreground 196 "$switched_usage_error"
    end

    rm -f "$codexbar_cache_file"
end

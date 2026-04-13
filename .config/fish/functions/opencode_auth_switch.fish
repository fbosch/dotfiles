function opencode_auth_switch --description 'Switch active OpenCode provider with generated profile names'
    set -l auth_file "$HOME/.local/share/opencode/auth.json"
    set -l codex_auth_file "$HOME/.codex/auth.json"
    set -l codex_profiles_file "$HOME/.codex/auth-profiles.json"
    set -l codexbar_cache_file "$HOME/.cache/nvim/codexbar/data.json"
    set -l alias_map \
        "openai|indigo-harbor-ddce|fbb" \
        "openai|atlas-thicket-3afa|jpb" \
        "openai|aurora-auroraforge-efd2|work"
    set -l adjectives ember cobalt amber jade coral indigo silver scarlet atlas lotus cedar pine aurora frost orbit dune maple zenith
    set -l nouns falcon otter comet harbor meadow emberfox lynx kestrel glacier thicket river moss canyon beacon auroraforge wave ridge
    set -l palette_dark 39 45 51 75 81 87 111 117 123 159 195 214 220 226
    set -l palette_light 18 19 20 22 23 24 52 53 54 88 89 90 94 124
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

    if not command -q jq
        echo "jq is required"
        return 1
    end

    if not command -q gum
        echo "gum is required"
        return 1
    end

    jq -e '.' "$auth_file" >/dev/null 2>&1
    if test $status -ne 0
        echo "failed to parse: $auth_file"
        return 1
    end

    set -l usage_query 'def rem($p): (100 - (($p // 0) | tonumber | floor)) | if . < 0 then 0 elif . > 100 then 100 else . end; .[0] as $root | ($root.usage.primary // null) as $primary | ($root.usage.secondary // null) as $secondary | [($root.provider // "codex"), (if $primary then (rem($primary.usedPercent) | tostring) else "" end), ($primary.resetsAt // ""), (if $secondary then (rem($secondary.usedPercent) | tostring) else "" end), ($secondary.resetsAt // "")] | @tsv'
    set -l usage_bar_width 16

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
            set -l primary_bar_filled (gum style --foreground "$primary_color" (string repeat -n $primary_filled -- "█"))
            set -l primary_bar_empty (gum style --foreground 240 (string repeat -n $primary_empty -- "░"))
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
            set -l secondary_bar_filled (gum style --foreground "$secondary_color" (string repeat -n $secondary_filled -- "█"))
            set -l secondary_bar_empty (gum style --foreground 240 (string repeat -n $secondary_empty -- "░"))
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

    set -l providers (jq -r 'keys[]' "$auth_file" 2>/dev/null)
    set -l mapped_providers
    for key in $providers
        if string match -rq _ -- "$key"
            continue
        end

        set -l provider "$key"
        if contains -- "$provider" $mapped_providers
            continue
        end

        set -l provider_re (string escape --style=regex -- "$provider")
        set -l provider_pattern "^$provider_re"'_.+$'
        set -l suffixed_matches (string match -r -- "$provider_pattern" $providers)
        if test (count $suffixed_matches) -gt 0
            set mapped_providers $mapped_providers "$provider"
        end
    end

    if test (count $mapped_providers) -eq 0
        echo "no providers with switchable variants found"
        return 1
    end

    set -l provider $mapped_providers[1]
    if test (count $mapped_providers) -gt 1
        set provider (printf "%s\n" $mapped_providers | gum choose --header="Select provider")
        if test -z "$provider"
            return 0
        end
    end

    if not jq -e --arg provider "$provider" 'has($provider)' "$auth_file" >/dev/null
        echo "active provider key not found: $provider"
        return 1
    end

    set -l profile_labels
    set -l profile_plain_labels
    set -l profile_keys
    set -l provider_pattern "^$provider"'_.+$'
    set profile_keys (string match -r -- "$provider_pattern" $providers)

    for key in $profile_keys
        set -l account_id (jq -r --arg key "$key" '.[$key].accountId // ""' "$auth_file")
        if test -z "$account_id"
            set account_id "$key"
        end

        set -l seed_hex (string replace -ra '[^0-9a-fA-F]' '' -- "$account_id")
        if test -z "$seed_hex"
            set seed_hex 00
        end

        set -l a_hex (string sub -s 1 -l 2 -- "$seed_hex")
        set -l n_hex (string sub -s 3 -l 2 -- "$seed_hex")
        set -l c_hex (string sub -s 5 -l 2 -- "$seed_hex")
        if test -z "$a_hex"
            set a_hex 00
        end
        if test -z "$n_hex"
            set n_hex 00
        end
        if test -z "$c_hex"
            set c_hex 00
        end

        set -l a_index (math "(0x$a_hex % "(count $adjectives)") + 1")
        set -l n_index (math "(0x$n_hex % "(count $nouns)") + 1")
        set -l palette $palette_dark
        if test "$bg_mode" = light
            set palette $palette_light
        end

        set -l color_index (math "(0x$c_hex % "(count $palette)") + 1")
        set -l color $palette[$color_index]
        set -l id_tail (string sub -s (math "max(1, "(string length -- "$account_id")" - 3)") -l 4 -- "$account_id")

        set -l generated_label "$adjectives[$a_index]-$nouns[$n_index]-$id_tail"
        set -l label "$generated_label"
        for alias_entry in $alias_map
            set -l alias_parts (string split '|' -- "$alias_entry")
            if test (count $alias_parts) -ne 3
                continue
            end

            if test "$alias_parts[1]" = "$provider"; and test "$alias_parts[2]" = "$generated_label"
                set label "$label ($alias_parts[3])"
                break
            end
        end

        set -l color_label (printf '\e[1;38;5;%sm%s\e[0m' "$color" "$label")
        set profile_labels $profile_labels "$color_label"
        set profile_plain_labels $profile_plain_labels "$label"
    end

    if test (count $profile_labels) -eq 0
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

    set -l selected_label ""
    for i in (seq (count $profile_keys))
        if test "$profile_keys[$i]" = "$target_key"
            set selected_label "$profile_plain_labels[$i]"
            break
        end
    end
    if test -z "$selected_label"
        set selected_label "$target_key"
    end

    set -l selected_account_id (jq -r --arg key "$target_key" '.[$key].accountId // ""' "$auth_file")

    set -l inactive_key "$target_key"
    if not string match -rq -- "^$provider"'_[0-9]+$' "$inactive_key"
        set -l inactive_index 1
        while true
            set -l candidate "$provider"_"$inactive_index"
            if test "$candidate" = "$target_key"
                set inactive_key "$candidate"
                break
            end

            if jq -e --arg key "$candidate" 'has($key)' "$auth_file" >/dev/null
                set inactive_index (math "$inactive_index + 1")
                continue
            end

            set inactive_key "$candidate"
            break
        end
    end

    set -l tmp_file (mktemp)

    jq --arg active "$provider" --arg selected "$target_key" --arg inactive "$inactive_key" '
        if (has($active) | not) or (has($selected) | not) then
            error("missing provider key")
        elif ($inactive != $selected) and has($inactive) then
            error("inactive key already exists")
        else
            . as $root
            | ($root[$active]) as $active_value
            | ($root[$selected]) as $selected_value
            | del(.[$active], .[$selected])
            | .[$active] = $selected_value
            | .[$inactive] = $active_value
        end
    ' "$auth_file" >"$tmp_file"

    if test $status -ne 0
        rm -f "$tmp_file"
        echo "failed to update auth file"
        return 1
    end

    mv "$tmp_file" "$auth_file"

    set -l codex_status "codex unchanged"
    set -l switched_usage_tsv ""
    set -l switched_usage_error ""
    if test -n "$selected_account_id"; and test -f "$codex_auth_file"
        set -l codex_current_account_id (jq -r '.tokens.account_id // ""' "$codex_auth_file" 2>/dev/null)
        if test $status -eq 0
            if not test -f "$codex_profiles_file"
                printf '{"profiles":{}}\n' >"$codex_profiles_file"
                chmod 600 "$codex_profiles_file" 2>/dev/null
            end

            if jq -e '.profiles | type == "object"' "$codex_profiles_file" >/dev/null 2>&1
                if test -n "$codex_current_account_id"
                    set -l codex_profiles_tmp (mktemp)
                    jq --arg id "$codex_current_account_id" --slurpfile auth "$codex_auth_file" '.profiles[$id] = $auth[0]' "$codex_profiles_file" >"$codex_profiles_tmp"
                    if test $status -eq 0
                        mv "$codex_profiles_tmp" "$codex_profiles_file"
                        chmod 600 "$codex_profiles_file" 2>/dev/null
                    else
                        rm -f "$codex_profiles_tmp"
                    end
                end

                if jq -e --arg id "$selected_account_id" '.profiles[$id]' "$codex_profiles_file" >/dev/null 2>&1
                    set -l codex_auth_tmp (mktemp)
                    jq --arg id "$selected_account_id" '.profiles[$id]' "$codex_profiles_file" >"$codex_auth_tmp"
                    if test $status -eq 0
                        mv "$codex_auth_tmp" "$codex_auth_file"
                        chmod 600 "$codex_auth_file" 2>/dev/null
                        set codex_status "codex switched: $selected_account_id"

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
                    else
                        rm -f "$codex_auth_tmp"
                        set codex_status "codex update failed"
                    end
                else
                    set codex_status "codex profile missing for: $selected_account_id (run codex login once)"
                end
            else
                set codex_status "codex profiles file invalid: $codex_profiles_file"
            end
        else
            set codex_status "codex auth parse failed: $codex_auth_file"
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

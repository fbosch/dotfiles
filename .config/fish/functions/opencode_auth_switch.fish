function opencode_auth_switch --description 'Switch active OpenCode provider with generated profile names'
    set -l auth_file "$HOME/.local/share/opencode/auth.json"
    set -l codex_auth_file "$HOME/.codex/auth.json"
    set -l codex_profiles_file "$HOME/.codex/auth-profiles.json"
    set -l codexbar_cache_file "$HOME/.cache/nvim/codexbar/data.json"
    set -l alias_map \
        "openai|indigo-harbor-ddce|fbb" \
        "openai|atlas-thicket-3afa|jpb"
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
    rm -f "$codexbar_cache_file"
end

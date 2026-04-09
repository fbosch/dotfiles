function opencode_profile_switch --description 'Switch OpenCode model profile'
    set -l config_root "$HOME/.config/opencode"
    if set -q OPENCODE_CONFIG_DIR
        set config_root "$OPENCODE_CONFIG_DIR"
    end

    set -l profiles_file "$config_root/profiles.jsonc"
    set -l opencode_file "$config_root/opencode.json"
    if test -f "$config_root/opencode.jsonc"
        set opencode_file "$config_root/opencode.jsonc"
    end

    if not test -f "$profiles_file"
        echo "profiles file not found: $profiles_file"
        return 1
    end

    if not test -f "$opencode_file"
        echo "config file not found: $opencode_file"
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

    if not command -q python3
        echo "python3 is required"
        return 1
    end

    set -l helper_dir (path dirname (status filename))
    set -l jsonc_helper "$helper_dir/opencode_profile_switch_jsonc.py"
    if not test -f "$jsonc_helper"
        echo "jsonc helper not found: $jsonc_helper"
        return 1
    end

    set -l profiles_tmp (mktemp)
    python3 "$jsonc_helper" "$profiles_file" "$profiles_tmp"

    if test $status -ne 0
        rm -f "$profiles_tmp"
        echo "failed to parse profiles: $profiles_file"
        return 1
    end

    jq -e '.profiles | type == "object"' "$profiles_tmp" >/dev/null 2>&1
    if test $status -ne 0
        rm -f "$profiles_tmp"
        echo "failed to parse profiles: $profiles_file"
        return 1
    end

    set -l opencode_parse_file "$opencode_file"
    if string match -q '*.jsonc' "$opencode_file"
        set opencode_parse_file (mktemp)
        python3 "$jsonc_helper" "$opencode_file" "$opencode_parse_file"

        if test $status -ne 0
            rm -f "$profiles_tmp"
            rm -f "$opencode_parse_file"
            echo "failed to parse config: $opencode_file"
            return 1
        end
    end

    jq -e '.' "$opencode_parse_file" >/dev/null 2>&1
    if test $status -ne 0
        rm -f "$profiles_tmp"
        if test "$opencode_parse_file" != "$opencode_file"
            rm -f "$opencode_parse_file"
        end
        echo "failed to parse config: $opencode_file"
        return 1
    end

    set -l profile_names (jq -r '.profiles | keys[]' "$profiles_tmp")
    if test (count $profile_names) -eq 0
        rm -f "$profiles_tmp"
        echo "no profiles found in: $profiles_file"
        return 1
    end

    set -l current_snapshot (jq -c '{ model: (.model // null), small_model: (.small_model // null), agents: ((.agent // {}) | with_entries(.value = (.value.model // null))) }' "$opencode_parse_file")
    set -l active_profile ""
    for profile in $profile_names
        set -l is_match (jq -r --arg profile "$profile" --argjson current "$current_snapshot" '
            .profiles[$profile] as $p
            | {
                model: ($p.model // null),
                small_model: ($p.small_model // null),
                agents: ($current.agents | with_entries(.value = ($p.agents[.key] // null)))
              }
            | (. == $current)
            | tostring
        ' "$profiles_tmp")

        if test "$is_match" = true
            set active_profile "$profile"
            break
        end
    end

    set -l choice_labels
    set -l choice_to_profile
    for profile in $profile_names
        set -l description (jq -r --arg profile "$profile" '.profiles[$profile].description // ""' "$profiles_tmp")
        set -l label "$profile"
        if test -n "$description"
            set label "$profile - $description"
        end

        if test -n "$active_profile"; and test "$active_profile" = "$profile"
            set label "* $label"
        end

        set choice_labels $choice_labels "$label"
        set choice_to_profile $choice_to_profile "$profile"
    end

    set -l chooser_header "Select OpenCode model profile"
    if test -n "$active_profile"
        set chooser_header "Select OpenCode model profile (current: $active_profile)"
    end

    set -l selected_label (printf "%s\n" $choice_labels | gum choose --header="$chooser_header")
    if test -z "$selected_label"
        rm -f "$profiles_tmp"
        return 0
    end

    set -l selected_profile ""
    for i in (seq (count $choice_labels))
        if test "$choice_labels[$i]" = "$selected_label"
            set selected_profile "$choice_to_profile[$i]"
            break
        end
    end

    if test -z "$selected_profile"
        rm -f "$profiles_tmp"
        echo "failed to resolve selected profile"
        return 1
    end

    set -l opencode_tmp (mktemp)
    jq --arg profile "$selected_profile" --slurpfile profiles "$profiles_tmp" '
        $profiles[0].profiles[$profile] as $p
        | if $p == null then
            error("missing profile")
          else
            .model = ($p.model // .model)
            | .small_model = ($p.small_model // .small_model)
            | .agent = (
                (.agent // {})
                | with_entries(
                    .value = (
                      (.value // {}) as $agent
                      | ($p.agents[.key] // null) as $m
                      | if $m == null then
                          ($agent | del(.model))
                        else
                          ($agent + { model: $m })
                        end
                    )
                  )
              )
            | reduce ($p.agents // {} | keys[]) as $k (.;
                if (.agent | has($k)) then
                    .
                else
                    .agent[$k] = { model: $p.agents[$k] }
                end
              )
          end
    ' "$opencode_parse_file" >"$opencode_tmp"

    if test $status -ne 0
        rm -f "$profiles_tmp" "$opencode_tmp"
        if test "$opencode_parse_file" != "$opencode_file"
            rm -f "$opencode_parse_file"
        end
        echo "failed to apply profile: $selected_profile"
        return 1
    end

    mv "$opencode_tmp" "$opencode_file"
    set -l description (jq -r --arg profile "$selected_profile" '.profiles[$profile].description // ""' "$profiles_tmp")
    rm -f "$profiles_tmp"
    if test "$opencode_parse_file" != "$opencode_file"
        rm -f "$opencode_parse_file"
    end

    if test -n "$description"
        echo "opencode profile switched: $selected_profile - $description"
    else
        echo "opencode profile switched: $selected_profile"
    end
end

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

    if not command -q gum
        echo "gum is required"
        return 1
    end

    if not command -q bun
        echo "bun is required"
        return 1
    end

    set -l helper_dir (path dirname (status filename))
    set -l fish_root (path resolve "$helper_dir/..")
    set -l libexec_dir "$fish_root/libexec"
    set -l helper "opencode_profile_switch_helper.ts"
    if not test -f "$libexec_dir/$helper"
        echo "profile helper not found: $libexec_dir/$helper"
        return 1
    end

    set -l list_json (bun --cwd "$libexec_dir" --install=auto "$helper" list "$profiles_file" "$opencode_file")
    if test $status -ne 0
        echo "failed to load profiles"
        return 1
    end

    set -l profile_count (printf '%s' "$list_json" | jq '.profiles | length')
    if test $status -ne 0 -o "$profile_count" = 0
        echo "no profiles found in: $profiles_file"
        return 1
    end

    set -l active_profile (printf '%s' "$list_json" | jq -r '.profiles[] | select(.active == true) | .name' | head -n 1)
    set -l choice_labels
    set -l choice_to_profile

    for profile in (printf '%s' "$list_json" | jq -r '.profiles[].name')
        set -l description (printf '%s' "$list_json" | jq -r --arg profile "$profile" '.profiles[] | select(.name == $profile) | .description // ""')
        set -l is_active (printf '%s' "$list_json" | jq -r --arg profile "$profile" '.profiles[] | select(.name == $profile) | .active | tostring')
        set -l label "$profile"
        if test -n "$description"
            set label "$profile - $description"
        end
        if test "$is_active" = true
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
        echo "failed to resolve selected profile"
        return 1
    end

    set -l apply_json (bun --cwd "$libexec_dir" --install=auto "$helper" apply "$profiles_file" "$opencode_file" "$selected_profile")
    if test $status -ne 0
        echo "failed to apply profile: $selected_profile"
        return 1
    end

    set -l description (printf '%s' "$apply_json" | jq -r '.description // ""')
    if test -n "$description"
        echo "opencode profile switched: $selected_profile - $description"
    else
        echo "opencode profile switched: $selected_profile"
    end
end

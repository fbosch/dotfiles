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
    set -l helper "opencode/profile_switch_helper.ts"
    if not test -f "$libexec_dir/$helper"
        echo "profile helper not found: $libexec_dir/$helper"
        return 1
    end

    set -l list_lines (bun --smol --cwd "$libexec_dir" --install=auto "$helper" list "$profiles_file" "$opencode_file")
    if test $status -ne 0
        echo "failed to load profiles"
        return 1
    end

    if test -z "$list_lines"
        echo "no profiles found in: $profiles_file"
        return 1
    end

    set -l active_profile ""
    set -l choice_labels
    set -l choice_to_profile

    for row in $list_lines
        set -l parts (string split 	 -- "$row")
        if test (count $parts) -lt 3
            continue
        end

        set -l profile "$parts[1]"
        set -l description "$parts[2]"
        set -l is_active "$parts[3]"
        set -l label "$profile"
        if test -n "$description"
            set label "$profile - $description"
        end
        if test "$is_active" = true
            set label "* $label"
            if test -z "$active_profile"
                set active_profile "$profile"
            end
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

    set -l description (bun --smol --cwd "$libexec_dir" --install=auto "$helper" apply "$profiles_file" "$opencode_file" "$selected_profile")
    if test $status -ne 0
        echo "failed to apply profile: $selected_profile"
        return 1
    end

    if test -n "$description"
        echo "opencode profile switched: $selected_profile - $description"
    else
        echo "opencode profile switched: $selected_profile"
    end
end

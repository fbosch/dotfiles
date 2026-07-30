function opencode_auth_switch --description 'Switch active OpenCode provider with generated profile names'
    set -l auth_file "$HOME/.local/share/opencode/auth.json"
    set -l codex_auth_file "$HOME/.codex/auth.json"
    set -l codex_profiles_file "$HOME/.codex/auth-profiles.json"
    set -l usage_query '.usage as $windows | [(.provider // "codex"), (($windows[0].remaining // "") | tostring), ($windows[0].resetsAt // ""), (($windows[1].remaining // "") | tostring), ($windows[1].resetsAt // "")] | @tsv'
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

    function __opencode_fetch_usage_tsv --argument-names query helper_cwd usage_helper
        bun --cwd "$helper_cwd" "$usage_helper" usage 2>/dev/null | jq -r "$query" 2>/dev/null
    end

    function __opencode_usage_color --argument-names capacity_band
        switch "$capacity_band"
            case high
                echo 42
            case medium
                echo 220
            case low
                echo 208
            case critical
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
            set -l primary_segments (__rate_limit_bar_segments \
                --remaining "$primary_remaining" \
                --width "$bar_width" \
                --filled "█" \
                --empty "░" \
                --minimum-one)
            set -l primary_fields (string split \t -- "$primary_segments")
            set -l primary_color (__opencode_usage_color "$primary_fields[3]")
            set -l primary_bar_filled ""
            if test -n "$primary_fields[1]"
                set primary_bar_filled (gum style --foreground "$primary_color" "$primary_fields[1]")
            end
            set -l primary_bar_empty ""
            if test -n "$primary_fields[2]"
                set primary_bar_empty (gum style --foreground 240 "$primary_fields[2]")
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
            set -l secondary_segments (__rate_limit_bar_segments \
                --remaining "$secondary_remaining" \
                --width "$bar_width" \
                --filled "█" \
                --empty "░" \
                --minimum-one)
            set -l secondary_fields (string split \t -- "$secondary_segments")
            set -l secondary_color (__opencode_usage_color "$secondary_fields[3]")
            set -l secondary_bar_filled ""
            if test -n "$secondary_fields[1]"
                set secondary_bar_filled (gum style --foreground "$secondary_color" "$secondary_fields[1]")
            end
            set -l secondary_bar_empty ""
            if test -n "$secondary_fields[2]"
                set secondary_bar_empty (gum style --foreground 240 "$secondary_fields[2]")
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
    set -l reset_helper "$libexec_dir/codex/reset_helper.ts"
    if not test -f "$helper"
        echo "helper not found: $helper"
        return 1
    end
    if not test -f "$reset_helper"
        echo "helper not found: $reset_helper"
        return 1
    end

    set -l current_usage_tsv (__opencode_fetch_usage_tsv "$usage_query" "$libexec_dir" "$reset_helper")
    set -l current_usage_status $status
    if test $current_usage_status -eq 0; and test -n "$current_usage_tsv"
        __opencode_render_usage "current" "$current_usage_tsv" "$usage_bar_width"
    else
        gum style --foreground 196 "current usage unavailable (OpenAI request failed)"
    end

    echo ""

    set -l list_lines (bun --cwd "$libexec_dir" "$helper" list "$auth_file" "$bg_mode")
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
        if test "$key" = "$provider"
            set label "$label (active)"
        end
        set -a profile_keys "$key"
        set -a profile_plain_labels "$label"
        set -a profile_labels (printf '\e[1;38;5;%sm%s\e[0m' "$color" "$label")
    end

    if test (count $profile_keys) -eq 0
        echo "no profiles found for provider: $provider"
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

    if test "$target_key" = "$provider"
        echo "provider already active: $provider"
        return 0
    end

    set -l selected_label "$profile_plain_labels[$selected_index]"
    if test -z "$selected_label"
        set selected_label "$target_key"
    end

    set -l codex_status (bun --cwd "$libexec_dir" "$helper" apply "$auth_file" "$codex_auth_file" "$codex_profiles_file" "$provider" "$target_key")
    if test $status -ne 0
        echo "failed to apply auth switch"
        return 1
    end

    set -l switched_usage_tsv ""
    set -l switched_usage_error ""

    set -l wezterm_cache_base "$XDG_CACHE_HOME"
    if test -z "$wezterm_cache_base"
        set wezterm_cache_base "$HOME/.cache"
    end
    set -l wezterm_status_cache "$wezterm_cache_base/wezterm/codex-status.json"
    rm -f "$wezterm_status_cache"
    wezterm_set_user_var codex_profile_changed (date +%s)

    set switched_usage_tsv (__opencode_fetch_usage_tsv "$usage_query" "$libexec_dir" "$reset_helper")
    set -l switched_usage_fetch_status $status
    if test $switched_usage_fetch_status -eq 0; and test -n "$switched_usage_tsv"
        set switched_usage_error ""
    else
        set switched_usage_error "switched usage unavailable (OpenAI request failed)"
        set switched_usage_tsv ""
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
end

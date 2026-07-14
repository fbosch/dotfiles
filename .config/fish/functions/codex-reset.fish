function codex-reset --description "Show or redeem banked Codex rate-limit resets"
    set -l auth_file ""
    set -l credit_id ""
    set -l dry_run false
    set -l refresh false

    argparse 'h/help' 'auth=' 'credit-id=' 'dry-run' 'refresh' -- $argv
    or return 2

    if set -q _flag_help
        printf '%s\n' \
            "Usage: codex-reset [status] [--refresh] [--auth PATH]" \
            "       codex-reset consume [--credit-id ID] [--dry-run] [--auth PATH]" \
            "" \
            "Shows available banked Codex rate-limit resets or redeems one."
        return 0
    end

    if set -q _flag_auth
        set auth_file "$_flag_auth"
    end
    if set -q _flag_credit_id
        set credit_id "$_flag_credit_id"
    end
    if set -q _flag_dry_run
        set dry_run true
    end
    if set -q _flag_refresh
        set refresh true
    end

    set -l action status
    if test (count $argv) -gt 1
        echo "error: expected one command: status or consume" >&2
        return 2
    else if test (count $argv) -eq 1
        set action "$argv[1]"
    end
    if not contains -- "$action" status consume
        echo "error: unknown command: $action" >&2
        return 2
    end
    if test "$action" = status; and test -n "$credit_id"
        echo "error: --credit-id is only valid with consume" >&2
        return 2
    end
    if test "$action" = status; and test "$dry_run" = true
        echo "error: --dry-run is only valid with consume" >&2
        return 2
    end
    if test "$action" = consume; and test "$refresh" = true
        echo "error: --refresh is only valid with status" >&2
        return 2
    end

    for command in bun jq
        if not command -q "$command"
            echo "error: $command is required" >&2
            return 1
        end
    end

    set -l helper_dir (path dirname (status filename))
    set -l fish_root (path resolve "$helper_dir/..")
    set -l libexec_dir "$fish_root/libexec"
    set -l reset_helper "$libexec_dir/codex/reset_helper.ts"
    set -l aliases_helper "$libexec_dir/opencode/auth_switch_helper.ts"
    if not test -f "$reset_helper"
        echo "error: helper not found: $reset_helper" >&2
        return 1
    end

    set -l helper_auth_args
    if test -n "$auth_file"
        set helper_auth_args --auth "$auth_file"
    end

    if test "$action" = consume
        set -l preview_args consume-preview $helper_auth_args
        if test -n "$credit_id"
            set -a preview_args --credit-id "$credit_id"
        end
        set -l preview (bun --cwd "$libexec_dir" "$reset_helper" $preview_args)
        if test $status -ne 0
            return 1
        end

        set -l preview_credit (printf '%s\n' "$preview" | jq -c '.credit')
        if test "$preview_credit" = null
            echo "no available credits to redeem."
            return 0
        end

        set credit_id (printf '%s\n' "$preview_credit" | jq -r '.id')
        set -l preview_fields (printf '%s\n' "$preview_credit" | jq -r '[.nickname, (.resetType // "unknown"), (.grantedAt // "unknown"), (.expiresAt // "unknown"), .expiresIn, .id] | @tsv')
        set -l fields (string split \t -- "$preview_fields")
        set -l heading_color ""
        set -l muted_color ""
        set -l urgency_color ""
        set -l color_reset ""
        if test -t 1
            set heading_color (set_color --bold yellow)
            set muted_color (set_color brblack)
            switch (printf '%s\n' "$preview_credit" | jq -r '.urgency')
                case urgent
                    set urgency_color (set_color red)
                case soon
                    set urgency_color (set_color yellow)
                case later
                    set urgency_color (set_color green)
            end
            set color_reset (set_color normal)
        end
        printf '\n%sRedeem reset credit%s\n' "$heading_color" "$color_reset"
        printf '  %-14s %s\n' "Credit" "$fields[1]"
        printf '  %-14s %s\n' "Type" "$fields[2]"
        printf '  %-14s %s%s%s (%s)\n' "Expires" "$urgency_color" "$fields[4]" "$color_reset" "$fields[5]"
        printf '  %-14s %s\n' "Granted" "$fields[3]"
        printf '  %-14s %s%s%s\n' "ID" "$muted_color" "$fields[6]" "$color_reset"
        if test "$dry_run" = true
            printf '\n%sDry run:%s no reset was redeemed.\n' "$muted_color" "$color_reset"
            return 0
        end
        if not command -q gum
            echo "error: gum is required to confirm redemption" >&2
            return 1
        end

        set -l confirmation (gum input --prompt "Type confirm to redeem this reset: " --placeholder "confirm")
        if test $status -ne 0; or test "$confirmation" != confirm
            echo "aborted."
            return 1
        end

        set -l result (bun --cwd "$libexec_dir" "$reset_helper" consume $helper_auth_args --credit-id "$credit_id")
        if test $status -ne 0
            return 1
        end
        set -l result_fields (printf '%s\n' "$result" | jq -r '[(.windowsReset // "unknown"), (.code // "unknown"), (.redeemedAt // "unknown")] | @tsv')
        set fields (string split \t -- "$result_fields")
        set -l success_color ""
        if test -t 1
            set success_color (set_color --bold green)
        end
        printf '\n%sReset redeemed%s\n' "$success_color" "$color_reset"
        printf '  %-14s %s\n' "Windows reset" "$fields[1]"
        printf '  %-14s %s\n' "Redeemed" "$fields[3]"
        printf '  %-14s %s%s%s\n' "Code" "$muted_color" "$fields[2]" "$color_reset"
        return 0
    end

    set -l status_args status $helper_auth_args
    if test "$refresh" = true
        set -a status_args --refresh
    end
    set -l status_payload (bun --cwd "$libexec_dir" "$reset_helper" $status_args)
    if test $status -ne 0
        return 1
    end

    set -l account_alias_lines
    set -l opencode_auth_file "$HOME/.local/share/opencode/auth.json"
    if test -f "$aliases_helper"; and test -f "$opencode_auth_file"
        set account_alias_lines (bun --cwd "$libexec_dir" "$aliases_helper" aliases "$opencode_auth_file" dark)
    end

    set -l active_account_id (printf '%s\n' "$status_payload" | jq -r '.active.accountId')
    set -l active_alias "account-"(string sub -s -4 -- "$active_account_id")
    for account_alias_line in $account_alias_lines
        set -l fields (string split \t -- "$account_alias_line")
        if test "$fields[1]" = "$active_account_id"
            set active_alias "$fields[2]"
            break
        end
    end

    set -l credit_lines (printf '%s\n' "$status_payload" | jq -r '.active.credits[] | [.urgency, .status, .expiresIn, .id, .nickname, (.title // "")] | @tsv')
    set -l nearest_urgency unknown
    for credit_line in $credit_lines
        set -l fields (string split \t -- "$credit_line")
        if test "$fields[2]" = available
            set nearest_urgency "$fields[1]"
            break
        end
    end

    set -l available_count (printf '%s\n' "$status_payload" | jq -r '.active.availableCount')
    set -l count_color ""
    set -l color_reset ""
    if test -t 1
        switch "$nearest_urgency"
            case urgent
                set count_color (set_color red)
            case soon
                set count_color (set_color yellow)
            case later
                set count_color (set_color green)
            case '*'
                set count_color (set_color brblack)
        end
        set color_reset (set_color normal)
    end
    printf 'banked reset credits: %s%s%s available (%s)\n' "$count_color" "$available_count" "$color_reset" "$active_alias"

    for credit_line in $credit_lines
        set -l fields (string split \t -- "$credit_line")
        set -l urgency "$fields[1]"
        set -l credit_status "$fields[2]"
        set -l expires_in "$fields[3]"
        set -l current_credit_id "$fields[4]"
        set -l nickname "$fields[5]"
        set -l title "$fields[6]"
        set -l urgency_color ""
        set -l nickname_color ""
        set -l dim ""
        if test -t 1
            switch "$urgency"
                case urgent
                    set urgency_color (set_color red)
                case soon
                    set urgency_color (set_color yellow)
                case later
                    set urgency_color (set_color green)
                case '*'
                    set urgency_color (set_color brblack)
            end
            set -l nickname_palette blue magenta cyan brblue brmagenta brcyan
            set -l color_index (math "0x"(string sub -s 11 -l 2 -- (string replace -r '^.*_' '' -- "$current_credit_id"))" % "(count $nickname_palette)" + 1")
            set nickname_color (set_color --bold "$nickname_palette[$color_index]")
            set dim (set_color brblack)
        end

        printf '  %s%-10s expires in %-7s %s%s%s\n' "$urgency_color" "$credit_status" "$expires_in" "$nickname_color" "$nickname" "$color_reset"
        printf '                               %s%s%s\n' "$dim" "$current_credit_id" "$color_reset"
        if test -n "$title"
            printf '                               %s%s%s\n' "$dim" "$title" "$color_reset"
        end
    end

    printf '\ncurrent usage:\n'
    set -l usage_rows (printf '%s\n' "$status_payload" | jq -r '.active.usage[] | [.name, (.remaining // ""), (.window // "n/a"), (.resetsIn // "n/a")] | @tsv')
    for usage_row in $usage_rows
        set -l usage_fields (string split \t -- "$usage_row")
        set -l window_name "$usage_fields[1]"
        set -l remaining "$usage_fields[2]"
        if test -z "$remaining"
            printf '  %-9s n/a\n' "$window_name"
            continue
        end

        set -l bar_segments (__rate_limit_bar_segments --remaining "$remaining" --width 18 --filled = --empty -)
        set -l bar_fields (string split \t -- "$bar_segments")
        set -l capacity_color ""
        set -l muted_color ""
        if test -t 1
            switch "$bar_fields[3]"
                case high
                    set capacity_color (set_color green)
                case medium
                    set capacity_color (set_color yellow)
                case low
                    set capacity_color (set_color brred)
                case critical
                    set capacity_color (set_color red)
            end
            set muted_color (set_color brblack)
        end
        printf '  %-9s [%s%s%s%s%s] %s%3s%%%s remaining  %s window, resets in %s\n' \
            "$window_name" "$capacity_color" "$bar_fields[1]" "$color_reset" "$muted_color" "$bar_fields[2]" "$capacity_color" "$remaining" "$color_reset" "$usage_fields[3]" "$usage_fields[4]"
    end

    if test "$available_count" -gt 0
        printf '\nrun `codex-reset consume` to redeem one credit now.\n'
    end
    printf '\naccounts:\n'
    set -l account_rows (printf '%s\n' "$status_payload" | jq -r '.accounts[] | [.accountId, (.availableCount // ""), (.urgency // "unknown"), (.error // ""), (.active | tostring)] | @tsv')
    for account_row in $account_rows
        set -l fields (string split \t -- "$account_row")
        set -l account_alias "account-"(string sub -s -4 -- "$fields[1]")
        for account_alias_line in $account_alias_lines
            set -l alias_fields (string split \t -- "$account_alias_line")
            if test "$alias_fields[1]" = "$fields[1]"
                set account_alias "$alias_fields[2]"
                break
            end
        end
        if test -n "$fields[4]"
            printf '  %s (reset availability unavailable, %s)\n' "$account_alias" "$fields[4]"
            continue
        end

        set -l account_color ""
        if test -t 1
            switch "$fields[3]"
                case urgent
                    set account_color (set_color red)
                case soon
                    set account_color (set_color yellow)
                case later
                    set account_color (set_color green)
                case '*'
                    set account_color (set_color brblack)
            end
        end
        if test "$fields[5]" = true
            printf '  %s (%s%s%s resets available, active)\n' "$account_alias" "$account_color" "$fields[2]" "$color_reset"
        else
            printf '  %s (%s%s%s resets available)\n' "$account_alias" "$account_color" "$fields[2]" "$color_reset"
        end
    end
end

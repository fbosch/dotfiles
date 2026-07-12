function codex-reset --description "Show or redeem banked Codex rate-limit resets"
    set -l auth_file ""
    set -l credit_id ""
    set -l dry_run false

    argparse 'h/help' 'auth=' 'credit-id=' 'dry-run' -- $argv
    or return 2

    if set -q _flag_help
        printf '%s\n' \
            "Usage: codex-reset [status] [--auth PATH]" \
            "       codex-reset consume [--credit-id ID] [--dry-run] [--auth PATH]" \
            "" \
            "Shows available banked Codex rate-limit resets or redeems one."
        return 0
    end

    if set -q _flag_auth
        set auth_file "$_flag_auth"
    else if set -q CODEX_HOME; and test -n "$CODEX_HOME"
        set auth_file "$CODEX_HOME/auth.json"
    else
        set auth_file "$HOME/.codex/auth.json"
    end

    if set -q _flag_credit_id
        set credit_id "$_flag_credit_id"
    end

    if set -q _flag_dry_run
        set dry_run true
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

    for command in curl jq
        if not command -q "$command"
            echo "error: $command is required" >&2
            return 1
        end
    end

    if not test -f "$auth_file"
        echo "error: auth file not found: $auth_file" >&2
        echo "run `codex login` first, or pass --auth" >&2
        return 1
    end

    set -l token (jq -er '.access_token // .tokens.access_token // empty' "$auth_file" 2>/dev/null)
    if test $status -ne 0; or test -z "$token"
        echo "error: auth file is missing access_token: $auth_file" >&2
        return 1
    end

    set -l account_id (jq -er '.account_id // .tokens.account_id // empty' "$auth_file" 2>/dev/null)
    if test $status -ne 0; or test -z "$account_id"
        echo "error: auth file is missing account_id: $auth_file" >&2
        return 1
    end

    set -l credits_response (curl --silent --show-error --connect-timeout 10 --max-time 30 --write-out '\n%{http_code}' \
        --header "Authorization: Bearer $token" \
        --header "ChatGPT-Account-Id: $account_id" \
        "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits")
    set -l curl_status $status
    if test $curl_status -ne 0
        echo "error: failed to list reset credits" >&2
        return 1
    end

    set -l credits_http "$credits_response[-1]"
    set -l credits_body (string join \n -- $credits_response[..-2])
    if test "$credits_http" != 200
        echo "error: listing reset credits failed (HTTP $credits_http)" >&2
        printf '%s\n' "$credits_body" | jq . 2>/dev/null; or printf '%s\n' "$credits_body" >&2
        return 1
    end

    if not printf '%s\n' "$credits_body" | jq -e . >/dev/null 2>&1
        echo "error: reset-credits endpoint returned invalid JSON" >&2
        return 1
    end

    if test "$action" = status
        set -l available_count (printf '%s\n' "$credits_body" | jq -r '.available_count // 0')
        set -l profiles_file (path dirname "$auth_file")/auth-profiles.json
        set -l account_alias_lines
        set -l helper_dir (path dirname (status filename))
        set -l fish_root (path resolve "$helper_dir/..")
        set -l libexec_dir "$fish_root/libexec"
        set -l aliases_helper "$libexec_dir/opencode/auth_switch_helper.ts"
        set -l opencode_auth_file "$HOME/.local/share/opencode/auth.json"
        if command -q bun; and test -f "$aliases_helper"; and test -f "$opencode_auth_file"
            set account_alias_lines (bun --cwd "$libexec_dir" "$aliases_helper" aliases "$opencode_auth_file" dark)
        end

        set -l active_alias "account-"(string sub -s -4 -- "$account_id")
        for account_alias_line in $account_alias_lines
            set -l fields (string split \t -- "$account_alias_line")
            if test "$fields[1]" = "$account_id"
                set active_alias "$fields[2]"
                break
            end
        end

        set -l credit_lines (printf '%s\n' "$credits_body" | jq -r '
            def expires_at:
                .expires_at? as $expires |
                if $expires == null then null
                else $expires | sub("[.][0-9]+Z$"; "Z") | fromdateiso8601?
                end;
            def urgency($expires):
                if $expires == null then "unknown"
                elif $expires <= now + 86400 then "urgent"
                elif $expires <= now + 604800 then "soon"
                else "later"
                end;
            def expires_in($expires):
                if $expires == null then "unknown"
                elif $expires <= now then "expired"
                else "\((($expires - now) / 86400 | ceil))d"
                end;
            .credits
            | sort_by(.expires_at // "9999-12-31T23:59:59Z")[]?
            | expires_at as $expires
            | [urgency($expires), .status, expires_in($expires), .id, (.title // "")]
            | @tsv
        ')
        set -l adjectives ember cobalt amber jade coral indigo silver scarlet atlas lotus cedar pine aurora frost orbit dune maple zenith
        set -l nouns falcon otter comet harbor meadow emberfox lynx kestrel glacier thicket river moss canyon beacon auroraforge wave ridge
        set -l nickname_colors blue magenta cyan brblue brmagenta brcyan
        set -l nearest_available_urgency unknown
        for credit_line in $credit_lines
            set -l fields (string split \t -- "$credit_line")
            if test "$fields[2]" = available
                set nearest_available_urgency "$fields[1]"
                break
            end
        end

        set -l active_count_color ""
        set -l active_count_reset ""
        if test -t 1
            switch "$nearest_available_urgency"
                case urgent
                    set active_count_color (set_color red)
                case soon
                    set active_count_color (set_color yellow)
                case later
                    set active_count_color (set_color green)
                case '*'
                    set active_count_color (set_color brblack)
            end
            set active_count_reset (set_color normal)
        end
        set -l active_count_display "$active_count_color$available_count$active_count_reset"
        printf 'banked reset credits: %s available (%s)\n' "$active_count_display" "$active_alias"

        for credit_line in $credit_lines
            set -l fields (string split \t -- "$credit_line")
            set -l urgency "$fields[1]"
            set -l credit_status "$fields[2]"
            set -l expires_in "$fields[3]"
            set -l current_credit_id "$fields[4]"
            set -l title "$fields[5]"
            set -l color ""
            set -l reset ""
            set -l dim ""
            set -l nickname_color ""
            set -l guid (string replace -r '^.*_' '' -- "$current_credit_id")
            set -l nickname "$current_credit_id"

            # Use GUID bytes after the account-switcher seeds for distinct labels.
            if string match -rq '^[0-9a-fA-F]{12,}$' -- "$guid"
                set -l adjective_byte (string sub -s 7 -l 2 -- "$guid")
                set -l noun_byte (string sub -s 9 -l 2 -- "$guid")
                set -l color_byte (string sub -s 11 -l 2 -- "$guid")
                set -l adjective_index (math "0x$adjective_byte % "(count $adjectives)" + 1")
                set -l noun_index (math "0x$noun_byte % "(count $nouns)" + 1")
                set -l color_index (math "0x$color_byte % "(count $nickname_colors)" + 1")
                set -l guid_suffix (string sub -s -4 -- "$guid")
                set nickname "$adjectives[$adjective_index]-$nouns[$noun_index]-$guid_suffix"

                if test -t 1
                    set nickname_color (set_color --bold "$nickname_colors[$color_index]")
                end
            end

            if test -t 1
                switch "$urgency"
                    case urgent
                        set color (set_color red)
                    case soon
                        set color (set_color yellow)
                    case later
                        set color (set_color green)
                    case '*'
                        set color (set_color brblack)
                end
                set reset (set_color normal)
                set dim (set_color brblack)
            end

            printf '  %s%-10s expires in %-7s %s%s%s\n' "$color" "$credit_status" "$expires_in" "$nickname_color" "$nickname" "$reset"
            printf '                               %s%s%s\n' "$dim" "$current_credit_id" "$reset"
            if test -n "$title"
                printf '                               %s%s%s\n' "$dim" "$title" "$reset"
            end
        end

        set -l usage_response (curl --silent --show-error --connect-timeout 10 --max-time 30 --write-out '\n%{http_code}' \
            --header "Authorization: Bearer $token" \
            --header "ChatGPT-Account-Id: $account_id" \
            "https://chatgpt.com/backend-api/wham/usage")
        set curl_status $status
        if test $curl_status -ne 0
            echo "error: failed to fetch current usage" >&2
            return 1
        end

        set -l usage_http "$usage_response[-1]"
        set -l usage_body (string join \n -- $usage_response[..-2])
        if test "$usage_http" != 200
            echo "error: fetching current usage failed (HTTP $usage_http)" >&2
            printf '%s\n' "$usage_body" | jq . 2>/dev/null; or printf '%s\n' "$usage_body" >&2
            return 1
        end

        if not printf '%s\n' "$usage_body" | jq -e . >/dev/null 2>&1
            echo "error: usage endpoint returned invalid JSON" >&2
            return 1
        end

        printf '\ncurrent usage:\n'
        set -l usage_rows (printf '%s\n' "$usage_body" | jq -r '
            def duration($seconds):
                if $seconds < 60 then "\($seconds)s"
                elif $seconds < 3600 then "\(($seconds / 60 | floor))m"
                elif $seconds < 86400 then "\(($seconds / 3600 * 10 | floor / 10))h"
                else "\(($seconds / 86400 * 10 | floor / 10))d"
                end;
            def remaining($window):
                if $window == null or $window.used_percent == null then null else
                    (100 - ($window.used_percent | floor))
                    | if . < 0 then 0 elif . > 100 then 100 else . end
                end;
            .rate_limit // {} |
            [["primary", .primary_window], ["secondary", .secondary_window]][] |
            .[0] as $name |
            .[1] as $window |
            [
                $name,
                remaining($window),
                if $window.limit_window_seconds == null then "n/a" else duration($window.limit_window_seconds) end,
                if $window.reset_after_seconds == null then "n/a" else duration($window.reset_after_seconds) end
            ] | @tsv
        ')
        set -l usage_bar_width 18
        for usage_row in $usage_rows
            set -l usage_fields (string split \t -- "$usage_row")
            set -l window_name "$usage_fields[1]"
            set -l remaining "$usage_fields[2]"
            set -l window_duration "$usage_fields[3]"
            set -l reset_duration "$usage_fields[4]"
            if test -z "$remaining"
                printf '  %-9s n/a\n' "$window_name"
                continue
            end

            set -l bar_segments (__rate_limit_bar_segments \
                --remaining "$remaining" \
                --width "$usage_bar_width" \
                --filled = \
                --empty -)
            set -l bar_fields (string split \t -- "$bar_segments")
            set -l filled_bar "$bar_fields[1]"
            set -l empty_bar "$bar_fields[2]"
            set -l capacity_band "$bar_fields[3]"
            set -l capacity_color ""
            set -l muted_color ""
            set -l reset_color ""
            if test -t 1
                switch "$capacity_band"
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
                set reset_color (set_color normal)
            end

            printf '  %-9s [%s%s%s%s%s] %s%3s%%%s remaining  %s window, resets in %s\n' \
                "$window_name" "$capacity_color" "$filled_bar" "$reset_color" "$muted_color" "$empty_bar" "$capacity_color" "$remaining" "$reset_color" "$window_duration" "$reset_duration"
        end

        if test "$available_count" -gt 0
            printf '\nrun `codex-reset consume` to redeem one credit now.\n'
        end

        printf '\naccounts:\n'
        printf '  %s (%s resets available, active)\n' "$active_alias" "$active_count_display"
        if test -f "$profiles_file"
            set -l profile_lines (jq -r '
                (.profiles // {}) | to_entries[] |
                .value.tokens? as $tokens |
                select($tokens.access_token? and $tokens.account_id?) |
                [$tokens.account_id, $tokens.access_token] | @tsv
            ' "$profiles_file" 2>/dev/null)
            if test $status -ne 0
                echo "warning: failed to parse saved Codex profiles: $profiles_file" >&2
            end

            for profile_line in $profile_lines
                set -l fields (string split \t -- "$profile_line")
                set -l profile_account_id "$fields[1]"
                set -l profile_token "$fields[2]"
                if test "$profile_account_id" = "$account_id"
                    continue
                end

                set -l profile_alias "account-"(string sub -s -4 -- "$profile_account_id")
                for account_alias_line in $account_alias_lines
                    set -l alias_fields (string split \t -- "$account_alias_line")
                    if test "$alias_fields[1]" = "$profile_account_id"
                        set profile_alias "$alias_fields[2]"
                        break
                    end
                end

                set -l profile_response (curl --silent --show-error --connect-timeout 10 --max-time 30 --write-out '\n%{http_code}' \
                    --header "Authorization: Bearer $profile_token" \
                    --header "ChatGPT-Account-Id: $profile_account_id" \
                    "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits")
                set -l profile_curl_status $status
                if test $profile_curl_status -ne 0
                    printf '  %s (reset availability unavailable)\n' "$profile_alias"
                    continue
                end

                set -l profile_http "$profile_response[-1]"
                set -l profile_body (string join \n -- $profile_response[..-2])
                if test "$profile_http" != 200
                    printf '  %s (reset availability unavailable, HTTP %s)\n' "$profile_alias" "$profile_http"
                    continue
                end

                set -l profile_summary (printf '%s\n' "$profile_body" | jq -er '
                    def expires_at:
                        .expires_at? as $expires |
                        if $expires == null then null
                        else $expires | sub("[.][0-9]+Z$"; "Z") | fromdateiso8601?
                        end;
                    def urgency($expires):
                        if $expires == null then "unknown"
                        elif $expires <= now + 86400 then "urgent"
                        elif $expires <= now + 604800 then "soon"
                        else "later"
                        end;
                    [.credits[]? | select(.status == "available") | expires_at] as $expires |
                    ($expires | if length == 0 then null else min end) as $nearest_expiry |
                    [(.available_count // 0), urgency($nearest_expiry)] | @tsv
                ' 2>/dev/null)
                if test $status -ne 0
                    printf '  %s (reset availability unavailable)\n' "$profile_alias"
                    continue
                end

                set -l profile_summary_fields (string split \t -- "$profile_summary")
                set -l profile_available_count "$profile_summary_fields[1]"
                set -l profile_urgency "$profile_summary_fields[2]"
                set -l profile_count_color ""
                set -l profile_count_reset ""
                if test -t 1
                    switch "$profile_urgency"
                        case urgent
                            set profile_count_color (set_color red)
                        case soon
                            set profile_count_color (set_color yellow)
                        case later
                            set profile_count_color (set_color green)
                        case '*'
                            set profile_count_color (set_color brblack)
                    end
                    set profile_count_reset (set_color normal)
                end
                set -l profile_count_display "$profile_count_color$profile_available_count$profile_count_reset"
                printf '  %s (%s resets available)\n' "$profile_alias" "$profile_count_display"
            end
        end
        return 0
    end

    set -l available_ids (printf '%s\n' "$credits_body" | jq -r '.credits[]? | select(.status == "available") | .id')
    if test (count $available_ids) -eq 0
        echo "no available credits to redeem."
        return 0
    end

    if test -z "$credit_id"
        set credit_id "$available_ids[1]"
    else if not contains -- "$credit_id" $available_ids
        echo "error: credit ID is not available: $credit_id" >&2
        return 1
    end

    printf '%s\n' "$credits_body" | jq -r --arg credit_id "$credit_id" '
        .credits[] | select(.id == $credit_id) |
        "about to redeem:\n  credit_id : \(.id)\n  reset_type: \(.reset_type)\n  granted_at: \(.granted_at)\n  expires_at: \(.expires_at)"
    '

    if test "$dry_run" = true
        echo "--dry-run: skipping POST."
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

    if not command -q uuidgen
        echo "error: uuidgen is required to consume a reset credit" >&2
        return 1
    end

    set -l payload (jq -n --arg credit_id "$credit_id" --arg redeem_request_id (uuidgen | string lower) \
        '{credit_id: $credit_id, redeem_request_id: $redeem_request_id}')
    set -l consume_response (curl --silent --show-error --connect-timeout 10 --max-time 30 --write-out '\n%{http_code}' \
        --request POST \
        --header "Authorization: Bearer $token" \
        --header "ChatGPT-Account-Id: $account_id" \
        --header "Content-Type: application/json" \
        --data "$payload" \
        "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume")
    set curl_status $status
    if test $curl_status -ne 0
        echo "error: failed to consume reset credit" >&2
        return 1
    end

    set -l consume_http "$consume_response[-1]"
    set -l consume_body (string join \n -- $consume_response[..-2])
    if test "$consume_http" != 200
        echo "error: consuming reset credit failed (HTTP $consume_http)" >&2
        printf '%s\n' "$consume_body" | jq . 2>/dev/null; or printf '%s\n' "$consume_body" >&2
        return 1
    end

    if not printf '%s\n' "$consume_body" | jq -e . >/dev/null 2>&1
        echo "error: consume endpoint returned invalid JSON" >&2
        return 1
    end

    printf '%s\n' "$consume_body" | jq -r '
        "consumed. windows_reset=\(.windows_reset), code=\(.code), redeemed_at=\(.credit.redeemed_at)"
    '
end

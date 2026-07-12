function codex-reset --description "Show or redeem banked Codex rate-limit resets"
    set -l auth_file ""
    set -l credit_id ""
    set -l dry_run false
    set -l assume_yes false

    argparse 'h/help' 'auth=' 'credit-id=' 'dry-run' 'y/yes' -- $argv
    or return 2

    if set -q _flag_help
        printf '%s\n' \
            "Usage: codex-reset [status] [--auth PATH]" \
            "       codex-reset consume [--credit-id ID] [--dry-run] [--yes] [--auth PATH]" \
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

    if set -q _flag_yes
        set assume_yes true
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
        printf '%s\n' "$credits_body" | jq -r '
            "banked credits: \(.available_count // 0) available",
            (.credits[]? |
                "  \(if .status == "available" then "*" else "-" end) \(.id)  status=\(.status)  granted=\(.granted_at)  expires=\(.expires_at)",
                if .title then "      \(.title)" else empty end
            )
        '

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
        printf '%s\n' "$usage_body" | jq -r '
            def duration($seconds):
                if $seconds < 60 then "\($seconds)s"
                elif $seconds < 3600 then "\(($seconds / 60 | floor))m"
                elif $seconds < 86400 then "\(($seconds / 3600 * 10 | floor / 10))h"
                else "\(($seconds / 86400 * 10 | floor / 10))d"
                end;
            def window($value):
                if $value == null then "n/a" else
                    [
                        if $value.used_percent == null then "?%" else "\($value.used_percent)% used" end,
                        if $value.limit_window_seconds then "window=\(duration($value.limit_window_seconds))" else empty end,
                        if $value.reset_after_seconds == null then empty else "resets in \(duration($value.reset_after_seconds))" end
                    ] | join(", ")
                end;
            .rate_limit // {} | "  primary  : \(window(.primary_window))\n  secondary: \(window(.secondary_window))"
        '

        set -l available_count (printf '%s\n' "$credits_body" | jq -r '.available_count // 0')
        if test "$available_count" -gt 0
            printf '\nrun `codex-reset consume` to redeem one credit now.\n'
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

    if test "$assume_yes" = false
        read -l -P "proceed? [y/N] " confirmation
        if not contains -- (string lower -- "$confirmation") y yes
            echo "aborted."
            return 1
        end
    end

    if test "$dry_run" = true
        echo "--dry-run: skipping POST."
        return 0
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

function opencode_transient_run --description 'Run opencode with transient local storage'
    if test (count $argv) -eq 0
        return 1
    end

    set -l temp_root (mktemp -d /tmp/opencode-transient.XXXXXX)
    mkdir -p "$temp_root/opencode" "$temp_root/state/opencode"

    set -l auth_source ""
    if set -q XDG_DATA_HOME
        set -l xdg_auth "$XDG_DATA_HOME/opencode/auth.json"
        if test -f "$xdg_auth"
            set auth_source "$xdg_auth"
        end
    end

    if test -z "$auth_source"
        set -l default_auth "$HOME/.local/share/opencode/auth.json"
        if test -f "$default_auth"
            set auth_source "$default_auth"
        end
    end

    if test -n "$auth_source"
        cp "$auth_source" "$temp_root/opencode/auth.json"
    end

    env \
        XDG_DATA_HOME="$temp_root" \
        XDG_STATE_HOME="$temp_root/state" \
        OPENCODE_DISABLE_PROJECT_CONFIG=1 \
        OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=1 \
        opencode $argv
    set -l exit_code $status

    rm -rf "$temp_root" 2>/dev/null
    return $exit_code
end

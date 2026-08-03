function ai_commit --description 'Generate AI-powered Commitizen commit message from staged changes'
    set -l script "$HOME/.config/opencode/plugins/ai-commit/cli.ts"
    set -l config_root "$HOME/.config/opencode"
    if set -q OPENCODE_CONFIG_DIR
        set config_root "$OPENCODE_CONFIG_DIR"
    end

    set -l profiles_file "$config_root/profiles.jsonc"
    set -l opencode_file "$config_root/opencode.json"
    if test -f "$config_root/opencode.jsonc"
        set opencode_file "$config_root/opencode.jsonc"
    end

    set -l helper_dir (path dirname (status filename))
    set -l fish_root (path resolve "$helper_dir/..")
    set -l profile_helper "$fish_root/libexec/opencode/profile_switch_helper.ts"
    set -l profile_models (bun --cwd "$fish_root/libexec" "$profile_helper" commit-models "$profiles_file" "$opencode_file")
    if test $status -ne 0
        echo "failed to load active OpenCode profile models"
        return 1
    end

    set -l profile_model (string match -r '"primary":"([^"]+)"' -- "$profile_models")
    if test (count $profile_model) -ne 2
        echo "failed to resolve active OpenCode commit model"
        return 1
    end

    if not set -q AI_COMMIT_MODEL
        set -lx AI_COMMIT_MODEL "$profile_model[2]"
    end
    set -lx AI_COMMIT_FALLBACK_MODELS "$profile_models"

    if set -q LEFTHOOK_OUTPUT
        set -lx LEFTHOOK_OUTPUT "$LEFTHOOK_OUTPUT,execution_out"
    else
        set -lx LEFTHOOK_OUTPUT execution_out
    end

    set -l opencode_path (__opencode_command_path)
    function __ai_commit_err -a message
        echo "$message"
    end

    if not command -v bun >/dev/null 2>&1
        __ai_commit_err "bun is required for ai_commit"
        functions -e __ai_commit_err
        return 1
    end

    if test -f "$script"
        if test (count $argv) -gt 0
            switch $argv[1]
                case restart-server restart
                    env -u HERDR_ENV -u HERDR_SOCKET_PATH -u HERDR_PANE_ID OPENCODE_BIN="$opencode_path" bun run "$script" --restart-server
                    set -l run_status $status
                    functions -e __ai_commit_err
                    return $run_status
            end
        end

        env -u HERDR_ENV -u HERDR_SOCKET_PATH -u HERDR_PANE_ID OPENCODE_BIN="$opencode_path" bun run "$script" $argv
        set -l run_status $status
        functions -e __ai_commit_err
        return $run_status
    end

    __ai_commit_err "Missing AI commit script at $script"
    functions -e __ai_commit_err
    return 1
end

function ai_commit --description 'Generate AI-powered Commitizen commit message from staged changes'
    set -l script "$HOME/.config/opencode/plugins/ai-commit/cli.ts"
    if set -q AI_COMMIT_MODEL; and test "$AI_COMMIT_MODEL" = "openai/gpt-5.1-codex-mini"
        set -lx AI_COMMIT_MODEL openai/gpt-5.4-mini-fast
    else if set -q AI_COMMIT_MODEL; and test "$AI_COMMIT_MODEL" = "openai/codex-mini-latest"
        set -lx AI_COMMIT_MODEL openai/gpt-5.4-mini-fast
    else if not set -q AI_COMMIT_MODEL
        set -lx AI_COMMIT_MODEL openai/gpt-5.4-mini-fast
    end

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
                    bun run "$script" --restart-server
                    set -l run_status $status
                    functions -e __ai_commit_err
                    return $run_status
            end
        end

        bun run "$script" $argv
        set -l run_status $status
        functions -e __ai_commit_err
        return $run_status
    end

    __ai_commit_err "Missing AI commit script at $script"
    functions -e __ai_commit_err
    return 1
end

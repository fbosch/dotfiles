function ai_commit --description 'Generate AI-powered Commitizen commit message from staged changes'
    set -l script "$HOME/.config/opencode/plugins/ai-commit/cli.ts"

    function __ai_commit_err -a message
        echo "$message"
    end

    if not command -v bun >/dev/null 2>&1
        __ai_commit_err "bun is required for ai_commit"
        functions -e __ai_commit_err
        return 1
    end

    if test -f "$script"
        bun run "$script" $argv
        set -l run_status $status
        functions -e __ai_commit_err
        return $run_status
    end

    __ai_commit_err "Missing AI commit script at $script"
    functions -e __ai_commit_err
    return 1
end

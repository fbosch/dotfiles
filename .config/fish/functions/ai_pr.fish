function ai_pr --description 'Generate AI-powered PR description comparing current branch against main'
    set -l script "$HOME/.config/opencode/plugins/ai-pr/cli.ts"

    function __ai_pr_err -a message
        echo "$message"
    end

    if not command -v bun >/dev/null 2>&1
        __ai_pr_err "bun is required for ai_pr"
        functions -e __ai_pr_err
        return 1
    end

    if test -f "$script"
        bun run "$script" $argv
        set -l run_status $status
        functions -e __ai_pr_err
        return $run_status
    end

    __ai_pr_err "Missing AI PR script at $script"
    functions -e __ai_pr_err
    return 1
end

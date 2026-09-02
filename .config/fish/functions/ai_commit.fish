function ai_commit --description 'Generate AI-powered Commitizen commit message from staged changes'
    set -l agent_dir "$HOME/.pi/agent"
    if set -q PI_CODING_AGENT_DIR
        set agent_dir "$PI_CODING_AGENT_DIR"
    end
    set -l script "$agent_dir/lib/ai-commit/cli.ts"

    if not command -v bun >/dev/null 2>&1
        echo "bun is required for ai_commit" >&2
        return 1
    end
    if not test -f "$script"
        echo "Missing AI commit script at $script" >&2
        return 1
    end

    # Keep successful pre-commit hooks quiet; Lefthook still prints failures.
    set -lx LEFTHOOK_OUTPUT failure
    set -lx CLICOLOR_FORCE 1
    bun run "$script" $argv
end

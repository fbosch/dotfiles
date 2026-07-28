function __opencode_command_path --description 'Print preferred OpenCode executable path'
    set -l npm_globals_bin_dir "$NPM_GLOBALS_BIN_DIR"
    if test -z "$npm_globals_bin_dir"
        set npm_globals_bin_dir "$HOME/.local/state/pnpm-globals/current/node_modules/.bin"
    end

    # Keep pnpm as a fallback while OpenCode migrates to llm-agents.nix.
    for candidate in /run/current-system/sw/bin/opencode /etc/profiles/per-user/$USER/bin/opencode $HOME/.nix-profile/bin/opencode /nix/var/nix/profiles/default/bin/opencode $npm_globals_bin_dir/opencode
        if test -x $candidate
            printf '%s\n' $candidate
            return 0
        end
    end

    command -s opencode
end

function __opencode_command_path --description 'Print preferred OpenCode executable path'
    for candidate in /run/current-system/sw/bin/opencode /etc/profiles/per-user/$USER/bin/opencode $HOME/.nix-profile/bin/opencode /nix/var/nix/profiles/default/bin/opencode
        if test -x $candidate
            printf '%s\n' $candidate
            return 0
        end
    end

    command -s opencode
end

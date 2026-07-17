function opencode --wraps=opencode --description 'Run OpenCode, preferring Nix profiles'
    set -l opencode_path (__opencode_command_path)
    if test -n "$opencode_path"
        if type -q mullvad-exclude
            command mullvad-exclude $opencode_path $argv
            return $status
        end

        command $opencode_path $argv
        return $status
    end

    if type -q mullvad-exclude
        command mullvad-exclude opencode $argv
        return $status
    end

    command opencode $argv
end

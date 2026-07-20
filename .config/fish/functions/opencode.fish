function opencode --wraps=opencode --description 'Run OpenCode, preferring Nix profiles'
    set -l opencode_path (__opencode_command_path)
    if test -z "$opencode_path"
        set opencode_path opencode
    end

    if type -q mullvad-exclude
        command mullvad-exclude $opencode_path $argv
        return $status
    end

    command $opencode_path $argv
end

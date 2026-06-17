function opencode --wraps=opencode --description 'Run OpenCode, preferring Nix profiles'
    set -l opencode_path (__opencode_command_path)
    if test -n "$opencode_path"
        command $opencode_path $argv
        return $status
    end

    command opencode $argv
end

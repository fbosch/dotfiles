function opencode --wraps=opencode --description 'Run OpenCode, preferring Nix profiles'
    set -l opencode_path (__opencode_command_path)
    if test -n "$opencode_path"
        if type -q mullvad-exclude
            command env -u OPENAI_API_KEY mullvad-exclude $opencode_path $argv
            return $status
        end

        command env -u OPENAI_API_KEY $opencode_path $argv
        return $status
    end

    if type -q mullvad-exclude
        command env -u OPENAI_API_KEY mullvad-exclude opencode $argv
        return $status
    end

    command env -u OPENAI_API_KEY opencode $argv
end

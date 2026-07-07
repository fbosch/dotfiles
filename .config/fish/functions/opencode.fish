function opencode --wraps=opencode --description 'Run OpenCode, preferring Nix profiles'
    set -l opencode_path (__opencode_command_path)
    if test -n "$opencode_path"
        command env -u OPENAI_API_KEY $opencode_path $argv
        return $status
    end

    command env -u OPENAI_API_KEY opencode $argv
end

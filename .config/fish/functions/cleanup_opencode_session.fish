function cleanup_opencode_session --description 'Remove OpenCode session artifacts'
    argparse v/verbose -- $argv
    or return 1

    if test (count $argv) -lt 1
        echo "Usage: cleanup_opencode_session [--verbose] <projectId/sessionId>"
        return 1
    end

    set -l session_path $argv[1]
    set -l session_id (basename $session_path)
    set -l storage_roots session session_diff

    for root in $storage_roots
        set -l session_file "$HOME/.local/share/opencode/storage/$root/$session_path.json"
        if test -f "$session_file"
            rm -f "$session_file" 2>/dev/null
            if set -q _flag_verbose
                echo "Removed session: $session_id"
                echo "Removed file: $session_file"
            end
        else
            if set -q _flag_verbose
                echo "Missing file: $session_file"
            end
        end
    end
end

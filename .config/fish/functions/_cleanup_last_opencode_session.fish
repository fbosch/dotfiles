function _cleanup_last_opencode_session
    # Run cleanup in background to avoid blocking the shell
    # The timeout ensures we don't hang if opencode export is slow
    fish -c '
        set -l last_session (timeout 2s opencode export 2>/dev/null | jq -r ".sessions[-1].id" 2>/dev/null)
        if test -n "$last_session" -a "$last_session" != "null"
            set -l opencode_dir "$HOME/.opencode"
            if test -d "$opencode_dir"
                fd -t d "^$last_session\$" "$opencode_dir" -x rm -rf {} \; 2>/dev/null &
            end
        end
    ' &>/dev/null &
    disown
end

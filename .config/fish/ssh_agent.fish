if not status is-interactive; or set -q NONO_CAP_FILE
    return
end

set -l managed_init "$HOME/.config/nix/ssh-agent.fish"
if not test -r "$managed_init"; or not command -q bun
    return
end

set -l inherited_socket "$SSH_AUTH_SOCK"
source "$managed_init"
set -l local_socket "$SSH_AUTH_SOCK"

set -l libexec_dir (path resolve (path dirname (status filename))/libexec)
set -l selected_socket (command bun --cwd "$libexec_dir" "$libexec_dir/ssh_agent.ts" "$inherited_socket" "$local_socket" "$HOME/.ssh/id_rsa")
# A key-loading failure can still leave a usable selected agent.
if test (count $selected_socket) -eq 1; and test -S "$selected_socket"
    set -gx SSH_AUTH_SOCK "$selected_socket"
else if test -n "$inherited_socket"
    set -gx SSH_AUTH_SOCK "$inherited_socket"
else
    set -e SSH_AUTH_SOCK
end

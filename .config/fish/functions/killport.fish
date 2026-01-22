function killport --description 'Kill the process listening on a specific port'
    set -l options h/help f/force
    argparse -n killport $options -- $argv
    or return

    if set -q _flag_help
        echo "Usage: killport [OPTIONS] PORT"
        echo "Kill the process listening on the specified port"
        echo ""
        echo "Options:"
        echo "  -h, --help   Show this help message"
        echo "  -f, --force  Skip confirmation prompt"
        return 0
    end

    if test (count $argv) -ne 1
        echo "killport: exactly one port number required" >&2
        echo "Usage: killport [OPTIONS] PORT" >&2
        return 1
    end

    set -l port $argv[1]

    # Validate port number
    if not string match -qr '^\d+$' -- $port
        echo "killport: invalid port number '$port'" >&2
        return 1
    end

    if test $port -lt 1 -o $port -gt 65535
        echo "killport: port must be between 1 and 65535" >&2
        return 1
    end

    # Find process using the port
    set -l pid (lsof -ti :$port 2>/dev/null)

    if test -z "$pid"
        echo "killport: no process found listening on port $port" >&2
        return 1
    end

    # Get process details
    set -l process_info (ps -p $pid -o comm= 2>/dev/null)
    
    if test -z "$process_info"
        set process_info "Unknown"
    end

    # Confirm before killing (unless --force is set)
    if not set -q _flag_force
        if command -v gum >/dev/null
            if not gum confirm "Kill process: $process_info [PID: $pid] on port $port?"
                echo "Cancelled"
                return 0
            end
        else
            # Fallback to read if gum is not available
            read -P "Kill process: $process_info [PID: $pid] on port $port? [y/N] " -l response
            if not string match -qir '^y(es)?$' -- $response
                echo "Cancelled"
                return 0
            end
        end
    end

    # Kill the process
    if kill $pid 2>/dev/null
        echo "Killed: $process_info [PID: $pid] on port $port"
    else
        # Try with force if regular kill failed
        if kill -9 $pid 2>/dev/null
            echo "Force killed: $process_info [PID: $pid] on port $port"
        else
            echo "killport: failed to kill PID $pid" >&2
            return 1
        end
    end
end

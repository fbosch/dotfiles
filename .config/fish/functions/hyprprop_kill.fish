function hyprprop_kill --description 'Select a window with hyprprop and kill it with pkill'
    set -l options h/help
    argparse -n hyprprop_kill $options -- $argv
    or return

    if set -q _flag_help
        echo "Usage: hyprprop_kill"
        echo "Interactively select a window with hyprprop and kill its process"
        return 0
    end

    # Check if hyprprop is available
    if not command -v hyprprop >/dev/null
        echo "hyprprop_kill: hyprprop not found" >&2
        return 1
    end

    # Get window info as JSON
    set -l window_json (hyprprop --raw 2>/dev/null)
    
    if test $status -ne 0
        echo "hyprprop_kill: Failed to get window information (selection cancelled?)" >&2
        return 1
    end

    # Extract PID and process info from JSON
    set -l pid (echo $window_json | jq -r '.pid // empty' 2>/dev/null)
    set -l title (echo $window_json | jq -r '.title // empty' 2>/dev/null)
    set -l class (echo $window_json | jq -r '.class // .initialClass // empty' 2>/dev/null)
    
    if test -z "$pid"
        echo "hyprprop_kill: Could not determine PID from window" >&2
        return 1
    end

    # Show process info for confirmation
    set -l display_name "$class"
    if test -n "$title"
        set display_name "$class ($title)"
    end

    # Confirm before killing
    if not gum confirm "Kill process: $display_name [PID: $pid]?"
        echo "Cancelled"
        return 0
    end

    # Kill the process by PID
    if kill $pid 2>/dev/null
        echo "Killed: $display_name [PID: $pid]"
    else
        # Try with force if regular kill failed
        if kill -9 $pid 2>/dev/null
            echo "Force killed: $display_name [PID: $pid]"
        else
            echo "hyprprop_kill: Failed to kill PID $pid" >&2
            return 1
        end
    end
end

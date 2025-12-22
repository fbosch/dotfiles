#!/usr/bin/env bash
# Window switcher wrapper that detects Alt release via process monitoring

set -euo pipefail

action="$1"

case "$action" in
  next|prev)
    # Send action to AGS bundled daemon
    ags request -i ags-bundled window-switcher "{\"action\":\"$action\"}"
    
    # Fork a background process to monitor for Alt release
    # This uses a simple polling approach checking if the parent shell is still running
    (
      sleep 0.1  # Small delay to let user continue tabbing
      
      # Poll every 50ms to check if we should commit
      # We'll commit after detecting inactivity or script termination
      count=0
      while [[ $count -lt 40 ]]; do  # Max 2 seconds (40 * 50ms)
        sleep 0.05
        count=$((count + 1))
        
        # Check if there's a new next/prev action - if so, exit this monitor
        # (another monitor will be spawned)
        if [[ -f "/tmp/ags-switcher-active-$$" ]]; then
          rm -f "/tmp/ags-switcher-active-$$"
          exit 0
        fi
      done
      
      # Timeout reached or Alt released - commit the switch
      ags request -i ags-bundled window-switcher '{"action":"commit"}' 2>/dev/null || true
    ) &
    
    # Mark this instance as the active one
    echo $$ > "/tmp/ags-switcher-active-$$"
    ;;
  commit)
    ags request -i ags-bundled window-switcher '{"action":"commit"}'
    ;;
  hide)
    ags request -i ags-bundled window-switcher '{"action":"hide"}'
    ;;
  *)
    echo "Usage: $0 {next|prev|commit|hide}"
    exit 1
    ;;
esac

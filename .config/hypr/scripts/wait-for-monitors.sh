#!/bin/bash
# Wait for both monitors to be detected before continuing Hyprland startup

TIMEOUT=10  # Maximum seconds to wait
INTERVAL=0.2  # Check interval

echo "Waiting for monitors to initialize..."

for ((i=0; i<$((TIMEOUT*5)); i++)); do
    # Check if both monitors are detected
    MONITOR_COUNT=$(hyprctl monitors -j | jq length)
    
    if [ "$MONITOR_COUNT" -ge 2 ]; then
        echo "Both monitors detected!"
        exit 0
    fi
    
    sleep $INTERVAL
done

echo "Warning: Timeout reached, proceeding with $MONITOR_COUNT monitor(s)"
exit 0  # Don't block startup even on timeout

#!/usr/bin/env bash
# Debug wrapper for start menu command
echo "$(date): Start menu triggered" >> /tmp/start-menu-debug.log

# Check if daemon is running
if pgrep -f "start-menu.tsx" > /dev/null; then
    echo "$(date): Daemon is running" >> /tmp/start-menu-debug.log
else
    echo "$(date): WARNING - Daemon not running!" >> /tmp/start-menu-debug.log
fi

# Try the request with retry logic
max_attempts=3
attempt=1

while [ $attempt -le $max_attempts ]; do
    echo "$(date): Attempt $attempt of $max_attempts" >> /tmp/start-menu-debug.log

    # Try the request with timeout
    timeout 1 ags request -i start-menu-daemon '{"action":"show"}' 2>> /tmp/start-menu-debug.log
    request_exit=$?

    echo "$(date): Attempt $attempt exit code: $request_exit" >> /tmp/start-menu-debug.log

    if [ $request_exit -eq 0 ]; then
        echo "$(date): Request successful on attempt $attempt" >> /tmp/start-menu-debug.log
        exit 0
    fi

    # Wait a bit before retry
    if [ $attempt -lt $max_attempts ]; then
        sleep 0.2
    fi

    attempt=$((attempt + 1))
done

echo "$(date): All attempts failed" >> /tmp/start-menu-debug.log
exit 1
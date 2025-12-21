#!/usr/bin/env bash

set -euo pipefail

# Window capture directory
SCREENSHOT_DIR="/tmp/hypr-window-captures"
mkdir -p "$SCREENSHOT_DIR"

# Debounce tracking
LAST_SCREENSHOT_FILE="$SCREENSHOT_DIR/.last_screenshot"
DEBOUNCE_MS=100  # Minimum milliseconds between screenshot runs

# Get current time in milliseconds
get_time_ms() {
  date +%s%3N
}

# Screenshot all windows on a given workspace (runs in background)
screenshot_workspace_windows() {
  local workspace_id="$1"
  
  # Debounce: skip if called too recently
  if [[ -f "$LAST_SCREENSHOT_FILE" ]]; then
    local last_time=$(cat "$LAST_SCREENSHOT_FILE")
    local current_time=$(get_time_ms)
    local elapsed=$((current_time - last_time))
    
    if [[ $elapsed -lt $DEBOUNCE_MS ]]; then
      return 0
    fi
  fi
  
  # Update last screenshot time
  get_time_ms > "$LAST_SCREENSHOT_FILE"
  
  # Small delay to let animations settle
  sleep 0.05
  
  # Get all clients on the workspace
  hyprctl clients -j | jq -r --arg ws "$workspace_id" '
    .[] | 
    select(.workspace.id == ($ws | tonumber) or .workspace.name == $ws) | 
    @json
  ' | while IFS= read -r window_json; do
    # Extract window properties
    local address=$(echo "$window_json" | jq -r '.address')
    local x=$(echo "$window_json" | jq -r '.at[0]')
    local y=$(echo "$window_json" | jq -r '.at[1]')
    local width=$(echo "$window_json" | jq -r '.size[0]')
    local height=$(echo "$window_json" | jq -r '.size[1]')
    
    # Clean address for filename (remove 0x prefix)
    local filename="${address#0x}.jpg"
    local output_path="$SCREENSHOT_DIR/$filename"
    
    # Screenshot the window region with low priority and optimized settings
    # -s 0.5: Half resolution for faster capture
    # -t jpeg: Faster encoding than PNG
    # -q 60: Lower quality for smaller files and faster encoding
    nice -n 19 grim -s 0.5 -t jpeg -q 60 -g "${x},${y} ${width}x${height}" "$output_path" 2>/dev/null || true
  done
}

# Handle Hyprland IPC events
handle_event() {
  case $1 in
    workspace\>\>*|workspace,*)
      # Extract workspace info (handles both >> and , formats)
      workspace="${1#workspace>>}"
      workspace="${workspace#workspace,}"
      # Run in background to avoid blocking
      screenshot_workspace_windows "$workspace" &
      ;;
    activewindow\>\>*|activewindow,*)
      # Extract window info for active window screenshot
      window_info="${1#activewindow>>}"
      window_info="${window_info#activewindow,}"
      
      # Get the active workspace and screenshot all its windows (in background)
      active_workspace=$(hyprctl activeworkspace -j | jq -r '.id')
      screenshot_workspace_windows "$active_workspace" &
      ;;
  esac
}

# Connect to Hyprland socket and process events
socat -U - "UNIX-CONNECT:$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock" \
  | while read -r line; do
      handle_event "$line"
    done

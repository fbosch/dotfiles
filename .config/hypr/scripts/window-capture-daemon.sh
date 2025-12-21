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

# Screenshot a single window (runs in background)
screenshot_active_window() {
  local window_address="$1"
  
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
  local timestamp=$(get_time_ms)
  echo "$timestamp" > "$LAST_SCREENSHOT_FILE"
  
  # Get window info
  local window_json=$(hyprctl clients -j | jq -r --arg addr "$window_address" '.[] | select(.address == $addr) | @json')
  
  if [[ -z "$window_json" ]]; then
    return 0
  fi
  
  # Extract window properties
  local x=$(echo "$window_json" | jq -r '.at[0]')
  local y=$(echo "$window_json" | jq -r '.at[1]')
  local width=$(echo "$window_json" | jq -r '.size[0]')
  local height=$(echo "$window_json" | jq -r '.size[1]')
  
  # Clean address for filename (remove 0x prefix)
  local address_clean="${window_address#0x}"
  local filename="${address_clean}_${timestamp}.jpg"
  local output_path="$SCREENSHOT_DIR/$filename"
  
  # Use grim directly with geometry to avoid cursor capture
  # grimblast's "active" mode seems to capture cursors on some Hyprland versions
  # Using direct geometry capture with grim gives us more control
  nice -n 19 grim -t jpeg -q 85 -g "${x},${y} ${width}x${height}" "$output_path" 2>/dev/null || true
  
  # Clean up old screenshots for this window (keep only latest)
  # Delete all timestamped files except the one we just created
  fd -t f "^${address_clean}_.*\.jpg$" "$SCREENSHOT_DIR" \
    --exec bash -c 'if [[ "{}" != "'"$output_path"'" ]]; then rm "{}"; fi' 2>/dev/null || true
}

# Handle Hyprland IPC events
handle_event() {
  case $1 in
    activewindow\>\>*|activewindow,*)
      # Extract window info - format: class,title or >>class>>title
      window_info="${1#activewindow>>}"
      window_info="${window_info#activewindow,}"
      
      # Get the active window address and screenshot it
      local active_address=$(hyprctl activewindow -j | jq -r '.address')
      if [[ -n "$active_address" && "$active_address" != "null" ]]; then
        screenshot_active_window "$active_address" &
      fi
      ;;
  esac
}

# Connect to Hyprland socket and process events
socat -U - "UNIX-CONNECT:$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock" \
  | while read -r line; do
      handle_event "$line"
    done

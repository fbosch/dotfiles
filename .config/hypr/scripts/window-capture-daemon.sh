#!/usr/bin/env bash

set -euo pipefail

# Window capture directory
SCREENSHOT_DIR="/tmp/hypr-window-captures"
mkdir -p "$SCREENSHOT_DIR"

# Debounce tracking
LAST_SCREENSHOT_FILE="$SCREENSHOT_DIR/.last_screenshot"
DEBOUNCE_MS=100  # Minimum milliseconds between screenshot runs

# Scale factor for reducing image size (1/3 of original)
SCALE_FACTOR=0.33

# Get current time in milliseconds
get_time_ms() {
  date +%s%3N
}

# Capture all visible windows from a single fullscreen screenshot
screenshot_all_windows() {
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
  
  # Get active workspace ID
  local active_workspace=$(hyprctl activeworkspace -j | jq -r '.id')
  
  # Capture full screen without cursor and scale it down immediately
  local temp_fullscreen="$SCREENSHOT_DIR/.fullscreen_${timestamp}.png"
  nice -n 19 grim "$temp_fullscreen" 2>/dev/null || return 0
  
  # Scale down the fullscreen capture to reduce processing load
  # Convert scale factor to percentage (0.33 -> 33%)
  local scale_percent=$(awk "BEGIN {printf \"%.0f\", $SCALE_FACTOR * 100}")
  local temp_scaled="$SCREENSHOT_DIR/.fullscreen_scaled_${timestamp}.png"
  nice -n 19 convert "$temp_fullscreen" -scale ${scale_percent}% "$temp_scaled" 2>/dev/null || { rm -f "$temp_fullscreen"; return 0; }
  rm -f "$temp_fullscreen"
  
  # Get all visible windows on active workspace and crop each one from the scaled fullscreen capture
  hyprctl clients -j | jq -c --arg ws "$active_workspace" '.[] | select(.workspace.id == ($ws | tonumber))' | while read -r window_json; do
    local address=$(echo "$window_json" | jq -r '.address')
    local x=$(echo "$window_json" | jq -r '.at[0]')
    local y=$(echo "$window_json" | jq -r '.at[1]')
    local width=$(echo "$window_json" | jq -r '.size[0]')
    local height=$(echo "$window_json" | jq -r '.size[1]')
    local mapped=$(echo "$window_json" | jq -r '.mapped // true')
    
    # Skip unmapped windows
    if [[ "$mapped" == "false" ]]; then
      continue
    fi
    
    # Scale the coordinates to match the scaled image
    local scaled_x=$(awk "BEGIN {printf \"%.0f\", $x * $SCALE_FACTOR}")
    local scaled_y=$(awk "BEGIN {printf \"%.0f\", $y * $SCALE_FACTOR}")
    local scaled_width=$(awk "BEGIN {printf \"%.0f\", $width * $SCALE_FACTOR}")
    local scaled_height=$(awk "BEGIN {printf \"%.0f\", $height * $SCALE_FACTOR}")
    
    # Clean address for filename (remove 0x prefix)
    local address_clean="${address#0x}"
    local filename="${address_clean}_${timestamp}.jpg"
    local output_path="$SCREENSHOT_DIR/$filename"
    
    # Crop the scaled fullscreen capture to this window's geometry
    nice -n 19 convert "$temp_scaled" -crop "${scaled_width}x${scaled_height}+${scaled_x}+${scaled_y}" -quality 85 "$output_path" 2>/dev/null || continue
    
    # Clean up old screenshots for this window (keep only latest)
    fd -t f "^${address_clean}_.*\.jpg$" "$SCREENSHOT_DIR" \
      --exec bash -c 'if [[ "{}" != "'"$output_path"'" ]]; then rm "{}"; fi' 2>/dev/null || true
  done
  
  # Clean up temporary scaled fullscreen capture
  rm -f "$temp_scaled"
}

# Handle Hyprland IPC events
handle_event() {
  case $1 in
    activewindow\>\>*|activewindow,*)
      # Screenshot all windows when active window changes
      screenshot_all_windows &
      ;;
  esac
}

# Connect to Hyprland socket and process events
socat -U - "UNIX-CONNECT:$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock" \
  | while read -r line; do
      handle_event "$line"
    done

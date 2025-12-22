#!/usr/bin/env bash

set -euo pipefail

# Window capture directory
SCREENSHOT_DIR="/tmp/hypr-window-captures"
mkdir -p "$SCREENSHOT_DIR"

# Tracking files
LAST_SCREENSHOT_FILE="$SCREENSHOT_DIR/.last_screenshot"
LAST_EVENT_FILE="$SCREENSHOT_DIR/.last_event"

# Debounce tracking
DEBOUNCE_MS=500  # Increased minimum time between screenshots

# Scale factor for reducing image size (1/3 of original)
SCALE_FACTOR=0.33
JPEG_QUALITY=70

# Delay after activewindow event before capturing
CAPTURE_DELAY_MS=800  # Wait this long after activewindow event

# Permanent layers that are always present
PERMANENT_LAYERS="hyprpaper waybar"

# Get current time in milliseconds
get_time_ms() {
  date +%s%3N
}

# Check if there are any transient layers present
has_transient_layers() {
  local current_layers=$(hyprctl layers -j 2>/dev/null | jq -r '[.. | .namespace? // empty] | unique | .[]' 2>/dev/null | tr '\n' ' ')
  
  if [[ -z "$current_layers" ]]; then
    return 1
  fi
  
  for layer in $current_layers; do
    if ! echo "$PERMANENT_LAYERS" | grep -qw "$layer"; then
      return 0
    fi
  done
  
  return 1
}

# Capture all visible windows from a single fullscreen screenshot
capture_screenshot() {
  local target_workspace="$1"
  
  # Check debounce
  if [[ -f "$LAST_SCREENSHOT_FILE" ]]; then
    local last_time=$(cat "$LAST_SCREENSHOT_FILE")
    local current_time=$(get_time_ms)
    local elapsed=$((current_time - last_time))
    
    if [[ $elapsed -lt $DEBOUNCE_MS ]]; then
      return 0
    fi
  fi
  
  # Sleep to let everything settle
  sleep $(awk "BEGIN {printf \"%.3f\", $CAPTURE_DELAY_MS / 1000}")
  
  # Verify workspace is still correct after delay
  local current_workspace=$(hyprctl activeworkspace -j 2>/dev/null | jq -r '.id' 2>/dev/null)
  if [[ "$current_workspace" != "$target_workspace" ]]; then
    return 0
  fi
  
  # Check for transient layers
  if has_transient_layers; then
    return 0
  fi
  
  # Update last screenshot time
  local timestamp=$(get_time_ms)
  echo "$timestamp" > "$LAST_SCREENSHOT_FILE"
  
  # Capture full screen
  local temp_fullscreen="$SCREENSHOT_DIR/.fullscreen_${timestamp}.jpg"
  nice -n 19 grim -t jpeg -q "$JPEG_QUALITY" "$temp_fullscreen" 2>/dev/null || return 0
  
  if [[ ! -s "$temp_fullscreen" ]]; then
    rm -f "$temp_fullscreen"
    return 0
  fi
  
  # Scale down
  local scale_percent=$(awk "BEGIN {printf \"%.0f\", $SCALE_FACTOR * 100}")
  local temp_scaled="$SCREENSHOT_DIR/.fullscreen_scaled_${timestamp}.jpg"
  nice -n 19 convert "$temp_fullscreen" -scale ${scale_percent}% -quality "$JPEG_QUALITY" "$temp_scaled" 2>/dev/null || { rm -f "$temp_fullscreen"; return 0; }
  rm -f "$temp_fullscreen"
  
  if [[ ! -s "$temp_scaled" ]]; then
    rm -f "$temp_scaled"
    return 0
  fi
  
  # Crop each window
  hyprctl clients -j 2>/dev/null | jq -c --arg ws "$current_workspace" '.[] | select(.workspace.id == ($ws | tonumber)) | {address, at, size, mapped}' 2>/dev/null | while read -r window_json; do
    local address=$(echo "$window_json" | jq -r '.address')
    local mapped=$(echo "$window_json" | jq -r '.mapped // true')
    
    [[ "$mapped" == "false" ]] && continue
    
    local x=$(echo "$window_json" | jq -r '.at[0]')
    local y=$(echo "$window_json" | jq -r '.at[1]')
    local width=$(echo "$window_json" | jq -r '.size[0]')
    local height=$(echo "$window_json" | jq -r '.size[1]')
    
    if [[ "$width" -le 0 ]] || [[ "$height" -le 0 ]]; then
      continue
    fi
    
    local scaled_x=$(awk "BEGIN {printf \"%.0f\", $x * $SCALE_FACTOR}")
    local scaled_y=$(awk "BEGIN {printf \"%.0f\", $y * $SCALE_FACTOR}")
    local scaled_width=$(awk "BEGIN {printf \"%.0f\", $width * $SCALE_FACTOR}")
    local scaled_height=$(awk "BEGIN {printf \"%.0f\", $height * $SCALE_FACTOR}")
    
    if [[ "$scaled_width" -le 0 ]] || [[ "$scaled_height" -le 0 ]]; then
      continue
    fi
    
    # Use fixed filename without timestamp
    local address_clean="${address#0x}"
    local filename="${address_clean}.jpg"
    local temp_output="$SCREENSHOT_DIR/.temp_${filename}"
    local output_path="$SCREENSHOT_DIR/$filename"
    
    nice -n 19 convert "$temp_scaled" \
      -crop "${scaled_width}x${scaled_height}+${scaled_x}+${scaled_y}" \
      +repage \
      -quality "$JPEG_QUALITY" \
      "$temp_output" 2>/dev/null || continue
    
    if [[ ! -s "$temp_output" ]]; then
      rm -f "$temp_output"
      continue
    fi
    
    local file_size=$(stat -f%z "$temp_output" 2>/dev/null || stat -c%s "$temp_output" 2>/dev/null || echo "0")
    if [[ "$file_size" -lt 500 ]]; then
      rm -f "$temp_output"
      continue
    fi
    
    local img_info=$(identify -format "%w %h" "$temp_output" 2>/dev/null)
    if [[ -z "$img_info" ]]; then
      rm -f "$temp_output"
      continue
    fi
    
    read -r img_width img_height <<< "$img_info"
    if [[ "$img_width" -le 10 ]] || [[ "$img_height" -le 10 ]]; then
      rm -f "$temp_output"
      continue
    fi
    
    # Only overwrite if validation passed
    mv "$temp_output" "$output_path"
  done
  
  rm -f "$temp_scaled"
}

# Handle Hyprland IPC events
handle_event() {
  case $1 in
    activewindow\>\>*|activewindow,*)
      # Record this event
      local timestamp=$(get_time_ms)
      echo "$timestamp" > "$LAST_EVENT_FILE"
      
      # Get workspace and trigger screenshot
      local workspace_at_event=$(hyprctl activeworkspace -j 2>/dev/null | jq -r '.id' 2>/dev/null)
      
      # Kill any pending screenshot processes for this workspace
      pkill -f "capture_screenshot $workspace_at_event" 2>/dev/null || true
      
      # Start new screenshot process
      capture_screenshot "$workspace_at_event" &
      ;;
  esac
}

# Connect to Hyprland socket and process events
socat -U - "UNIX-CONNECT:$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock" \
  | while read -r line; do
      handle_event "$line"
    done

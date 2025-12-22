#!/usr/bin/env bash

set -euo pipefail

# Window capture directory
SCREENSHOT_DIR="/tmp/hypr-window-captures"
mkdir -p "$SCREENSHOT_DIR"

# Debug log file
DEBUG_LOG="$SCREENSHOT_DIR/daemon-debug.log"
exec 2>> "$DEBUG_LOG"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] ========== Daemon started ==========" >&2

# Tracking files
LAST_SCREENSHOT_FILE="$SCREENSHOT_DIR/.last_screenshot"
LAST_EVENT_FILE="$SCREENSHOT_DIR/.last_event"
LAST_OVERLAY_FILE="$SCREENSHOT_DIR/.last_overlay"
CAPTURE_LOCK_FILE="$SCREENSHOT_DIR/.capture_lock"

# Debounce tracking
DEBOUNCE_MS=500  # Minimum time between screenshots
OVERLAY_COOLDOWN_MS=2000  # Wait this long after overlay disappears

# Scale factor for reducing image size (balanced for quality and performance)
# UI displays at max 320x180px, we store at ~1.5x for sharpness on scaling
SCALE_FACTOR=0.25
JPEG_QUALITY=70

# Delay after activewindow event before capturing
CAPTURE_DELAY_MS=800  # Wait this long after activewindow event

# AGS daemons to check for visibility
AGS_DAEMONS="window-switcher-daemon keyboard-layout-switcher-daemon volume-indicator-daemon"

# Only check AGS if overlay was detected within this time window
AGS_CHECK_WINDOW_MS=5000  # 5 seconds

# Get current time in milliseconds
get_time_ms() {
  date +%s%3N
}

# Check if any AGS overlay is visible
is_any_overlay_visible() {
  # Poll AGS daemons
  for daemon in $AGS_DAEMONS; do
    local response=$(ags request -i "$daemon" '{"action":"get-visibility"}' 2>/dev/null)
    
    if [[ "$response" == "visible" ]]; then
      echo "[$(date '+%H:%M:%S')] Overlay detected: $daemon is visible" >&2
      echo "$(get_time_ms)" > "$LAST_OVERLAY_FILE"
      return 0
    fi
  done
  
  return 1
}

# Check if we're still in cooldown period after an overlay
is_in_overlay_cooldown() {
  if [[ ! -f "$LAST_OVERLAY_FILE" ]]; then
    return 1
  fi
  
  local last_overlay_time=$(cat "$LAST_OVERLAY_FILE")
  local current_time=$(get_time_ms)
  local elapsed=$((current_time - last_overlay_time))
  
  if [[ $elapsed -lt $OVERLAY_COOLDOWN_MS ]]; then
    echo "[$(date '+%H:%M:%S')] Still in cooldown period (${elapsed}ms / ${OVERLAY_COOLDOWN_MS}ms)" >&2
    return 0
  fi
  
  return 1
}

# Capture all visible windows from a single fullscreen screenshot
capture_screenshot() {
  local target_workspace="$1"
  
  # Ensure lock is always released
  trap 'rm -f "$CAPTURE_LOCK_FILE"' RETURN
  
  # Check debounce
  if [[ -f "$LAST_SCREENSHOT_FILE" ]]; then
    local last_time=$(cat "$LAST_SCREENSHOT_FILE")
    local current_time=$(get_time_ms)
    local elapsed=$((current_time - last_time))
    
    if [[ $elapsed -lt $DEBOUNCE_MS ]]; then
      echo "[$(date '+%H:%M:%S')] Screenshot blocked: debounce (${elapsed}ms / ${DEBOUNCE_MS}ms)" >&2
      return 0
    fi
  fi
  
  # CRITICAL: Check for overlays IMMEDIATELY, before any delay
  # This catches overlays that close quickly (like window-switcher on Alt release)
  echo "[$(date '+%H:%M:%S')] Pre-delay overlay check..." >&2
  if is_any_overlay_visible; then
    echo "[$(date '+%H:%M:%S')] Screenshot blocked: overlay present (pre-delay)" >&2
    return 0
  fi
  
  # Check if we're still in cooldown after an overlay
  if is_in_overlay_cooldown; then
    echo "[$(date '+%H:%M:%S')] Screenshot blocked: overlay cooldown" >&2
    return 0
  fi
  
  # Sleep to let window animations settle
  echo "[$(date '+%H:%M:%S')] Waiting ${CAPTURE_DELAY_MS}ms for animations..." >&2
  sleep $(awk "BEGIN {printf \"%.3f\", $CAPTURE_DELAY_MS / 1000}")
  
  # Verify workspace is still correct after delay
  local current_workspace=$(hyprctl activeworkspace -j 2>/dev/null | jq -r '.id' 2>/dev/null)
  echo "[$(date '+%H:%M:%S')] Post-delay workspace check: $current_workspace (target: $target_workspace)" >&2
  
  if [[ "$current_workspace" != "$target_workspace" ]]; then
    echo "[$(date '+%H:%M:%S')] Screenshot blocked: workspace changed" >&2
    return 0
  fi
  
  # Double-check overlays after delay (catches overlays that opened during the wait)
  echo "[$(date '+%H:%M:%S')] Post-delay overlay check..." >&2
  if is_any_overlay_visible; then
    echo "[$(date '+%H:%M:%S')] Screenshot blocked: overlay present (post-delay)" >&2
    return 0
  fi
  
  echo "[$(date '+%H:%M:%S')] Capturing screenshot for workspace $current_workspace" >&2
  
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
  
  # Release lock
  rm -f "$CAPTURE_LOCK_FILE"
}

# Handle Hyprland IPC events
handle_event() {
  echo "[$(date '+%H:%M:%S')] Event received: $1" >&2
  
  case $1 in
    activewindow\>\>*|activewindow,*)
      echo "[$(date '+%H:%M:%S')] Processing activewindow event" >&2
      
      # Check if a capture is already in progress
      if [[ -f "$CAPTURE_LOCK_FILE" ]]; then
        # Check if lock is stale (older than 10 seconds)
        local lock_age=$(( $(get_time_ms) - $(cat "$CAPTURE_LOCK_FILE" 2>/dev/null || echo 0) ))
        if [[ $lock_age -lt 10000 ]]; then
          # Fresh lock, skip this event
          echo "[$(date '+%H:%M:%S')] Skipping: capture already in progress (lock age: ${lock_age}ms)" >&2
          return 0
        fi
        # Stale lock, remove it and continue
        echo "[$(date '+%H:%M:%S')] Removing stale lock (age: ${lock_age}ms)" >&2
        rm -f "$CAPTURE_LOCK_FILE"
      fi
      
      # Create lock with current timestamp
      get_time_ms > "$CAPTURE_LOCK_FILE"
      
      # Record this event
      local timestamp=$(get_time_ms)
      echo "$timestamp" > "$LAST_EVENT_FILE"
      
      # Get workspace and trigger screenshot
      local workspace_at_event=$(hyprctl activeworkspace -j 2>/dev/null | jq -r '.id' 2>/dev/null)
      echo "[$(date '+%H:%M:%S')] Starting capture for workspace $workspace_at_event" >&2
      
      # Start new screenshot process
      capture_screenshot "$workspace_at_event" &
      ;;
    *)
      echo "[$(date '+%H:%M:%S')] Ignoring non-activewindow event" >&2
      ;;
  esac
}

# Connect to Hyprland socket and process events
echo "[$(date '+%H:%M:%S')] Connecting to Hyprland socket..." >&2
socat -U - "UNIX-CONNECT:$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock" \
  | while read -r line; do
      handle_event "$line"
    done

#!/usr/bin/env bash

set -euo pipefail

# Window capture directory - using /dev/shm (tmpfs) for faster I/O
# Falls back to /tmp if /dev/shm is not available
if [[ -d "/dev/shm" ]]; then
  SCREENSHOT_DIR="/dev/shm/hypr-window-captures"
else
  SCREENSHOT_DIR="/tmp/hypr-window-captures"
fi
mkdir -p "$SCREENSHOT_DIR"

# Tracking files
LAST_SCREENSHOT_FILE="$SCREENSHOT_DIR/.last_screenshot"
LAST_EVENT_FILE="$SCREENSHOT_DIR/.last_event"
LAST_OVERLAY_FILE="$SCREENSHOT_DIR/.last_overlay"
CAPTURE_LOCK_FILE="$SCREENSHOT_DIR/.capture_lock"

# ============================================================================
# CONFIGURATION - Tune these values for performance/quality tradeoff
# ============================================================================

# Debounce and timing
DEBOUNCE_MS=500              # Minimum time between screenshots
OVERLAY_COOLDOWN_MS=2000     # Wait after overlay disappears before capturing
CAPTURE_DELAY_MS=800         # Wait after activewindow event (for animations)
                             # Reduce if you have fast/no animations (min: 100-200ms)
                             # Increase if screenshots capture mid-animation (max: 1000-1500ms)

# Image quality
SCALE_FACTOR=0.25            # Scale factor (0.25 = 25% of original size)
SCALE_PERCENT=25             # Pre-calculated as integer for bash arithmetic
JPEG_QUALITY=70              # JPEG compression quality (60-80 recommended)
                             # Lower = smaller files, faster processing, lower quality
                             # Higher = larger files, slower processing, better quality

# AGS overlay detection
AGS_DAEMONS="window-switcher-daemon keyboard-layout-switcher-daemon volume-indicator-daemon"
AGS_CHECK_WINDOW_MS=5000     # Time window for overlay detection (unused, kept for future)

# ============================================================================

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
      return 0
    fi
  fi
  
  # CRITICAL: Check for overlays IMMEDIATELY, before any delay
  # This catches overlays that close quickly (like window-switcher on Alt release)
  if is_any_overlay_visible; then
    return 0
  fi
  
  # Check if we're still in cooldown after an overlay
  if is_in_overlay_cooldown; then
    return 0
  fi
  
  # Sleep to let window animations settle
  sleep $(awk "BEGIN {printf \"%.3f\", $CAPTURE_DELAY_MS / 1000}")
  
  # Verify workspace is still correct after delay
  local current_workspace=$(hyprctl activeworkspace -j 2>/dev/null | jq -r '.id' 2>/dev/null)
  
  if [[ "$current_workspace" != "$target_workspace" ]]; then
    return 0
  fi
  
  # Double-check overlays after delay (catches overlays that opened during the wait)
  if is_any_overlay_visible; then
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
  
  # Scale down and convert to MPC (Magick Persistent Cache) for faster cropping
  local temp_mpc="$SCREENSHOT_DIR/.fullscreen_scaled_${timestamp}.mpc"
  nice -n 19 convert "$temp_fullscreen" -scale ${SCALE_PERCENT}% -quality "$JPEG_QUALITY" "$temp_mpc" 2>/dev/null || { rm -f "$temp_fullscreen"; return 0; }
  rm -f "$temp_fullscreen"
  
  if [[ ! -f "$temp_mpc" ]]; then
    rm -f "${temp_mpc%.mpc}.cache" 2>/dev/null
    return 0
  fi
  
  # Crop each window (parallel for better performance)
  # Use process substitution instead of pipe to avoid subshell issues with background jobs
  while read -r window_json; do
    # Parse all fields in a single jq invocation (6 jq calls → 1)
    IFS='|' read -r address mapped x y width height <<< "$(echo "$window_json" | jq -r '[.address, (.mapped // true), .at[0], .at[1], .size[0], .size[1]] | join("|")')"
    
    [[ "$mapped" == "false" ]] && continue
    
    if [[ "$width" -le 0 ]] || [[ "$height" -le 0 ]]; then
      continue
    fi
    
    # Use bash arithmetic instead of awk (much faster)
    local scaled_x=$(( x * SCALE_PERCENT / 100 ))
    local scaled_y=$(( y * SCALE_PERCENT / 100 ))
    local scaled_width=$(( width * SCALE_PERCENT / 100 ))
    local scaled_height=$(( height * SCALE_PERCENT / 100 ))
    
    if [[ "$scaled_width" -le 0 ]] || [[ "$scaled_height" -le 0 ]]; then
      continue
    fi
    
    # Use fixed filename without timestamp
    local address_clean="${address#0x}"
    local filename="${address_clean}.jpg"
    local temp_output="$SCREENSHOT_DIR/.temp_${filename}"
    local output_path="$SCREENSHOT_DIR/$filename"
    
    # Crop from MPC in parallel (background each crop operation)
    (
      local crop_result=$(nice -n 19 convert "$temp_mpc" \
        -crop "${scaled_width}x${scaled_height}+${scaled_x}+${scaled_y}" \
        +repage \
        -quality "$JPEG_QUALITY" \
        -write "$temp_output" \
        -format "%w %h" info: 2>/dev/null)
      
      # Validate output
      if [[ ! -s "$temp_output" ]]; then
        rm -f "$temp_output"
        exit 0
      fi
      
      # Check dimensions from convert output (no separate identify needed)
      if [[ -n "$crop_result" ]]; then
        read -r img_width img_height <<< "$crop_result"
        if [[ "$img_width" -le 10 ]] || [[ "$img_height" -le 10 ]]; then
          rm -f "$temp_output"
          exit 0
        fi
      else
        # Fallback if -format failed
        rm -f "$temp_output"
        exit 0
      fi
      
      # Only overwrite if validation passed
      mv "$temp_output" "$output_path"
    ) &
  done < <(hyprctl clients -j 2>/dev/null | jq -c --arg ws "$current_workspace" '.[] | select(.workspace.id == ($ws | tonumber)) | {address, at, size, mapped}' 2>/dev/null)
  
  # Wait for all parallel crops to complete
  wait
  
  # Cleanup MPC cache files
  rm -f "$temp_mpc" "${temp_mpc%.mpc}.cache"
  
  # Release lock
  rm -f "$CAPTURE_LOCK_FILE"
}

# Handle Hyprland IPC events
handle_event() {
  case $1 in
    activewindow\>\>*|activewindow,*)
      # Check if a capture is already in progress
      if [[ -f "$CAPTURE_LOCK_FILE" ]]; then
        # Check if lock is stale (older than 10 seconds)
        local lock_age=$(( $(get_time_ms) - $(cat "$CAPTURE_LOCK_FILE" 2>/dev/null || echo 0) ))
        if [[ $lock_age -lt 10000 ]]; then
          # Fresh lock, skip this event
          return 0
        fi
        # Stale lock, remove it and continue
        rm -f "$CAPTURE_LOCK_FILE"
      fi
      
      # Create lock with current timestamp
      get_time_ms > "$CAPTURE_LOCK_FILE"
      
      # Record this event
      local timestamp=$(get_time_ms)
      echo "$timestamp" > "$LAST_EVENT_FILE"
      
      # Get workspace and trigger screenshot
      local workspace_at_event=$(hyprctl activeworkspace -j 2>/dev/null | jq -r '.id' 2>/dev/null)
      
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

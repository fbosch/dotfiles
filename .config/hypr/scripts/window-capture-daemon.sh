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
WORKSPACE_CHANGE_FILE="$SCREENSHOT_DIR/.workspace_change"

# ============================================================================
# CONFIGURATION - Tune these values for performance/quality tradeoff
# ============================================================================

# Debounce and timing
DEBOUNCE_MS=100              # Minimum time between screenshots
OVERLAY_COOLDOWN_MS=0        # Wait after overlay disappears before capturing
CAPTURE_DELAY_MS=100         # Wait after activewindow event (for animations)
                             # Reduce if you have fast/no animations (min: 100-200ms)
                             # Increase if screenshots capture mid-animation (max: 1000-1500ms)
WORKSPACE_DELAY_MS=300       # Wait after workspace change (longer for workspace animations)

# Image quality
SCALE_FACTOR=0.25            # Scale factor (0.25 = 25% of original size)
SCALE_PERCENT=25             # Pre-calculated as integer for bash arithmetic
JPEG_QUALITY=70              # JPEG compression quality (60-80 recommended)
                             # Lower = smaller files, faster processing, lower quality
                             # Higher = larger files, slower processing, better quality

# Hyprland gaps (dynamically read from hyprctl)
# Extract first value from "2 2 2 2" format (top gap, but they're usually uniform)
GAPS_IN=$(hyprctl getoption general:gaps_in -j 2>/dev/null | jq -r '.custom' | awk '{print $1}')
GAPS_OUT=$(hyprctl getoption general:gaps_out -j 2>/dev/null | jq -r '.custom' | awk '{print $1}')

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
  local event_type="${2:-activewindow}"  # Default to activewindow if not specified
  local capture_id="$3"  # Unique ID for this capture attempt
  
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
  
  # Use different delay based on event type
  local delay_ms="$CAPTURE_DELAY_MS"
  if [[ "$event_type" == "workspace" ]]; then
    delay_ms="$WORKSPACE_DELAY_MS"
  fi
  
  # Sleep in small increments and check if workspace changed
  local elapsed_sleep=0
  local sleep_increment=100  # Check every 100ms
  while [[ $elapsed_sleep -lt $delay_ms ]]; do
    sleep 0.1  # 100ms
    elapsed_sleep=$((elapsed_sleep + sleep_increment))
    
    # If workspace changed, abort this capture (newer one will be triggered)
    if [[ -f "$WORKSPACE_CHANGE_FILE" ]]; then
      local current_change_id=$(cat "$WORKSPACE_CHANGE_FILE")
      if [[ "$current_change_id" != "$capture_id" ]]; then
        # A newer workspace change happened, abort
        return 0
      fi
    fi
  done
  
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
  
  # Get all monitors and their geometries
  local monitors_json=$(hyprctl monitors -j 2>/dev/null)
  
  # Capture each monitor separately and build a composite MPC
  local monitor_index=0
  declare -A monitor_mpc_files
  declare -A monitor_offsets
  
  while read -r monitor_data; do
    IFS='|' read -r mon_name mon_x mon_y mon_width mon_height <<< "$monitor_data"
    
    # Capture this monitor
    local temp_monitor_shot="$SCREENSHOT_DIR/.monitor_${monitor_index}_${timestamp}.jpg"
    grim -t jpeg -q "$JPEG_QUALITY" -o "$mon_name" "$temp_monitor_shot" 2>/dev/null || { monitor_index=$((monitor_index + 1)); continue; }
    
    if [[ ! -s "$temp_monitor_shot" ]]; then
      rm -f "$temp_monitor_shot"
      monitor_index=$((monitor_index + 1))
      continue
    fi
    
    # Scale down and convert to MPC
    local temp_monitor_mpc="$SCREENSHOT_DIR/.monitor_${monitor_index}_${timestamp}.mpc"
    convert "$temp_monitor_shot" \
      -scale ${SCALE_PERCENT}% \
      -quality "$JPEG_QUALITY" \
      -define jpeg:dct-method=fast \
      "$temp_monitor_mpc" 2>/dev/null || { rm -f "$temp_monitor_shot"; monitor_index=$((monitor_index + 1)); continue; }
    rm -f "$temp_monitor_shot"
    
    # Store MPC file and offset for this monitor
    monitor_mpc_files[$monitor_index]="$temp_monitor_mpc"
    monitor_offsets[$monitor_index]="${mon_x}|${mon_y}|${mon_width}|${mon_height}"
    
    monitor_index=$((monitor_index + 1))
  done < <(echo "$monitors_json" | jq -r '.[] | [.name, .x, .y, .width, .height] | join("|")')
  
  # Process each window
  while read -r window_json; do
    IFS='|' read -r address mapped x y width height <<< "$(echo "$window_json" | jq -r '[.address, (.mapped // true), .at[0], .at[1], .size[0], .size[1]] | join("|")')"
    
    [[ "$mapped" == "false" ]] && continue
    
    if [[ "$width" -le 0 ]] || [[ "$height" -le 0 ]]; then
      continue
    fi
    
    # Determine which monitor this window belongs to
    local window_center_x=$(( x + width / 2 ))
    local window_center_y=$(( y + height / 2 ))
    local target_monitor_index=-1
    local target_monitor_mpc=""
    local mon_offset_x=0
    local mon_offset_y=0
    
    # Find the monitor containing the window's center point
    for idx in "${!monitor_offsets[@]}"; do
      IFS='|' read -r mon_x mon_y mon_w mon_h <<< "${monitor_offsets[$idx]}"
      
      if [[ $window_center_x -ge $mon_x ]] && [[ $window_center_x -lt $(( mon_x + mon_w )) ]] && \
         [[ $window_center_y -ge $mon_y ]] && [[ $window_center_y -lt $(( mon_y + mon_h )) ]]; then
        target_monitor_index=$idx
        target_monitor_mpc="${monitor_mpc_files[$idx]}"
        mon_offset_x=$mon_x
        mon_offset_y=$mon_y
        break
      fi
    done
    
    # Skip if no monitor found (shouldn't happen, but be safe)
    if [[ $target_monitor_index -eq -1 ]] || [[ -z "$target_monitor_mpc" ]]; then
      continue
    fi
    
    # Adjust coordinates relative to monitor origin
    local relative_x=$(( x - mon_offset_x ))
    local relative_y=$(( y - mon_offset_y ))
    
    # Scale and adjust for gaps
    local scaled_x=$(( (relative_x + GAPS_IN) * SCALE_PERCENT / 100 ))
    local scaled_y=$(( (relative_y + GAPS_IN) * SCALE_PERCENT / 100 ))
    local scaled_width=$(( (width - 2 * GAPS_IN) * SCALE_PERCENT / 100 ))
    local scaled_height=$(( (height - 2 * GAPS_IN) * SCALE_PERCENT / 100 ))
    
    if [[ "$scaled_width" -le 0 ]] || [[ "$scaled_height" -le 0 ]]; then
      continue
    fi
    
    # Use fixed filename without timestamp
    local address_clean="${address#0x}"
    local filename="${address_clean}.jpg"
    local temp_output="$SCREENSHOT_DIR/.temp_${filename}"
    local output_path="$SCREENSHOT_DIR/$filename"
    
    # Crop from the appropriate monitor's MPC in parallel
    (
      convert "$target_monitor_mpc" \
        -crop "${scaled_width}x${scaled_height}+${scaled_x}+${scaled_y}" \
        +repage \
        -quality "$JPEG_QUALITY" \
        -define jpeg:dct-method=fast \
        -define jpeg:optimize-coding=false \
        "$temp_output" 2>/dev/null
      
      # Validate output exists and has content
      if [[ ! -s "$temp_output" ]]; then
        rm -f "$temp_output"
        exit 0
      fi
      
      # Only overwrite if validation passed
      mv "$temp_output" "$output_path"
    ) &
  done < <(hyprctl clients -j 2>/dev/null | jq -c --arg ws "$current_workspace" '.[] | select(.workspace.id == ($ws | tonumber)) | {address, at, size, mapped}' 2>/dev/null)
  
  # Wait for all parallel crops to complete
  wait
  
  # Cleanup all monitor MPC cache files
  for idx in "${!monitor_mpc_files[@]}"; do
    local mpc_file="${monitor_mpc_files[$idx]}"
    rm -f "$mpc_file" "${mpc_file%.mpc}.cache"
  done
  
  # Release lock
  rm -f "$CAPTURE_LOCK_FILE"
}

# Handle Hyprland IPC events
handle_event() {
  local event_type=""
  
  case $1 in
    activewindow\>\>*|activewindow,*)
      event_type="activewindow"
      ;;
    workspace\>\>*|workspace,*)
      event_type="workspace"
      ;;
    *)
      return 0
      ;;
  esac
  
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
  
  # Create unique capture ID for this event
  local capture_id="${timestamp}_${event_type}"
  echo "$capture_id" > "$WORKSPACE_CHANGE_FILE"
  
  # Get workspace and trigger screenshot
  local workspace_at_event=$(hyprctl activeworkspace -j 2>/dev/null | jq -r '.id' 2>/dev/null)
  
  # Start new screenshot process with event type and capture ID
  capture_screenshot "$workspace_at_event" "$event_type" "$capture_id" &
}

# Connect to Hyprland socket and process events
socat -U - "UNIX-CONNECT:$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock" \
  | while read -r line; do
      handle_event "$line"
    done

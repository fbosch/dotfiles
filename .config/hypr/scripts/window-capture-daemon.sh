#!/usr/bin/env bash

set -euo pipefail

DAEMON_LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/hypr-window-capture-daemon.lock"
exec 9>"$DAEMON_LOCK_FILE"
if command -v flock >/dev/null 2>&1; then
  if flock -n 9; then
    :
  else
    exit 0
  fi
fi

# Window capture directory - using /dev/shm (tmpfs) for faster I/O
# Falls back to /tmp if /dev/shm is not available
if [[ -d "/dev/shm" ]]; then
  SCREENSHOT_DIR="/dev/shm/hypr-window-captures"
else
  SCREENSHOT_DIR="/tmp/hypr-window-captures"
fi
mkdir -p "$SCREENSHOT_DIR"

# Clean up any orphaned temp files from previous daemon runs (crash/kill leaves these behind)
rm -f "$SCREENSHOT_DIR"/.monitor_*.mpc \
      "$SCREENSHOT_DIR"/.monitor_*.cache \
      "$SCREENSHOT_DIR"/.monitor_*.jpg \
      "$SCREENSHOT_DIR"/.temp_*.jpg

# Tracking files
LAST_SCREENSHOT_FILE="$SCREENSHOT_DIR/.last_screenshot"
LAST_EVENT_FILE="$SCREENSHOT_DIR/.last_event"
LAST_OVERLAY_FILE="$SCREENSHOT_DIR/.last_overlay"
CAPTURE_LOCK_FILE="$SCREENSHOT_DIR/.capture_lock"
WORKSPACE_CHANGE_FILE="$SCREENSHOT_DIR/.workspace_change"
LAST_HEALTHCHECK_FILE="$SCREENSHOT_DIR/.last_healthcheck"

# ============================================================================
# CONFIGURATION - Tune these values for performance/quality tradeoff
# ============================================================================

# Debounce and timing
DEBOUNCE_MS=100               # Minimum time between screenshots (~20 fps max)
OVERLAY_COOLDOWN_MS=5        # Wait after overlay disappears before capturing
CAPTURE_DELAY_MS=100          # Wait after activewindow event (for animations)
                             # Reduced for faster captures while still avoiding mid-animation
WORKSPACE_DELAY_MS=200       # Wait after workspace change (must be a multiple of 100ms)
LOCK_STALE_MS=10000          # Lock file considered stale after 10s
HEALTHCHECK_INTERVAL_MS=5000 # Run stale file cleanup every 5s
TEMP_FILE_MAX_AGE_S=30       # Remove stale intermediate files older than 30s

# External command timeouts
GRIM_TIMEOUT_S=2
MAGICK_TIMEOUT_S=3

# Image format and quality
JPEG_QUALITY=85              # JPEG quality setting (60-95 range)
                             # 85 provides excellent quality for previews with good performance
                             # Lower = smaller files, faster processing, lower quality
                             # Higher = larger files, slower processing, better quality

# Preview target dimensions (matches AGS window-switcher display size)
PREVIEW_TARGET_HEIGHT=180    # Target height for preview display
PREVIEW_TARGET_MAX_WIDTH=320 # Maximum width for preview display

# Hyprland query socket (faster than hyprctl - no process spawn)
HYPR_QUERY_SOCKET="$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket.sock"

# Keep in sync with `general.gaps_in` from hyprland.conf.
# Avoid querying `getoption` during early compositor startup because it can crash
# Hyprland v0.54.0 before config manager is fully initialized.
GAPS_IN=2

# AGS overlay detection
# Using bundled AGS instance - check window-switcher component visibility
AGS_BUNDLED_INSTANCE="ags-bundled"

# ============================================================================

now_ms() {
  local t="${EPOCHREALTIME//[.,]/}"
  printf '%s\n' "${t:0:13}"
}

run_with_timeout() {
  local timeout_s="$1"
  shift

  if command -v timeout >/dev/null 2>&1; then
    timeout --kill-after=1 "${timeout_s}s" "$@"
    return $?
  fi

  "$@"
}

cleanup_stale_temp_files() {
  local now_s="$EPOCHSECONDS"
  local file
  local mtime
  local age

  for file in \
    "$SCREENSHOT_DIR"/.monitor_*.jpg \
    "$SCREENSHOT_DIR"/.monitor_*.mpc \
    "$SCREENSHOT_DIR"/.monitor_*.cache \
    "$SCREENSHOT_DIR"/.temp_*.jpg; do
    [[ -e "$file" ]] || continue

    mtime=$(stat -c %Y "$file" 2>/dev/null || printf '0')
    age=$((now_s - mtime))

    if [[ $age -gt $TEMP_FILE_MAX_AGE_S ]]; then
      rm -f "$file"
    fi
  done
}

maybe_run_healthcheck() {
  local now
  now=$(now_ms)

  if [[ -f "$LAST_HEALTHCHECK_FILE" ]]; then
    local last
    last=$(< "$LAST_HEALTHCHECK_FILE")
    local elapsed=$((now - last))
    if [[ $elapsed -lt $HEALTHCHECK_INTERVAL_MS ]]; then
      return 0
    fi
  fi

  cleanup_stale_temp_files
  printf '%s\n' "$now" > "$LAST_HEALTHCHECK_FILE"
}

# Check if any AGS overlay is visible
is_any_overlay_visible() {
  # Check window-switcher visibility in bundled AGS instance
  local response
  response=$(ags request -i "$AGS_BUNDLED_INSTANCE" window-switcher '{"action":"get-visibility"}' 2>/dev/null)
  
  if [[ "$response" == "visible" ]]; then
    now_ms > "$LAST_OVERLAY_FILE"
    return 0
  fi
  
  return 1
}

# Check if we're still in cooldown period after an overlay
is_in_overlay_cooldown() {
  if [[ ! -f "$LAST_OVERLAY_FILE" ]]; then
    return 1
  fi
  
  local last_overlay_time
  last_overlay_time=$(< "$LAST_OVERLAY_FILE")
  local current_time
  current_time=$(now_ms)
  local elapsed=$((current_time - last_overlay_time))
  
  if [[ $elapsed -lt $OVERLAY_COOLDOWN_MS ]]; then
    return 0
  fi
  
  return 1
}

# Check if a window is obscured by any floating windows
# Arguments: window_x window_y window_width window_height workspace_id clients_json
# Returns: 0 if obscured, 1 if not obscured
is_window_obscured() {
  local win_x=$1
  local win_y=$2
  local win_width=$3
  local win_height=$4
  local workspace=$5
  local clients_json=$6

  # Get all floating windows in the same workspace from pre-fetched clients JSON
  while read -r floating_data; do
    [[ -z "$floating_data" ]] && continue
    
    IFS='|' read -r float_x float_y float_width float_height <<< "$floating_data"
    
    # Check if the floating window overlaps with our target window
    # Two rectangles overlap if:
    # - float_x < win_x + win_width (floating window's left edge is before target's right edge)
    # - float_x + float_width > win_x (floating window's right edge is after target's left edge)
    # - float_y < win_y + win_height (floating window's top edge is before target's bottom edge)
    # - float_y + float_height > win_y (floating window's bottom edge is after target's top edge)
    
    if [[ $float_x -lt $(( win_x + win_width )) ]] && \
       [[ $(( float_x + float_width )) -gt $win_x ]] && \
       [[ $float_y -lt $(( win_y + win_height )) ]] && \
       [[ $(( float_y + float_height )) -gt $win_y ]]; then
      # Overlap detected - window is obscured
      return 0
    fi
  done < <(jq -r --arg ws "$workspace" '.[] | select(.workspace.id == ($ws | tonumber) and .floating == true) | [.at[0], .at[1], .size[0], .size[1]] | join("|")' <<< "$clients_json" 2>/dev/null)
  
  # No overlap found
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
    local last_time
    last_time=$(< "$LAST_SCREENSHOT_FILE")
    local current_time
    current_time=$(now_ms)
    local elapsed=$((current_time - last_time))

    if [[ $elapsed -lt 0 ]]; then
      rm -f "$LAST_SCREENSHOT_FILE"
    elif [[ $elapsed -lt $DEBOUNCE_MS ]]; then
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
      local current_change_id
      current_change_id=$(< "$WORKSPACE_CHANGE_FILE")
      if [[ "$current_change_id" != "$capture_id" ]]; then
        # A newer workspace change happened, abort
        return 0
      fi
    fi
  done
  
  # Verify workspace is still correct after delay
  local current_workspace
  current_workspace=$(printf 'j/activeworkspace' | nc -U "$HYPR_QUERY_SOCKET" 2>/dev/null | jq -r '.id')
  
  if [[ "$current_workspace" != "$target_workspace" ]]; then
    return 0
  fi
  
  # Double-check overlays after delay (catches overlays that opened during the wait)
  if is_any_overlay_visible; then
    return 0
  fi
  
  # Update last screenshot time
  local timestamp
  timestamp=$(now_ms)
  printf '%s\n' "$timestamp" > "$LAST_SCREENSHOT_FILE"
  
  # Get all monitors and their geometries
  local monitors_json
  monitors_json=$(printf 'j/monitors' | nc -U "$HYPR_QUERY_SOCKET" 2>/dev/null)
  
  # Capture each monitor separately and keep at full resolution for cropping
  local monitor_index=0
  declare -A monitor_mpc_files
  declare -A monitor_offsets
  
  while read -r monitor_data; do
    IFS='|' read -r mon_name mon_x mon_y mon_width mon_height <<< "$monitor_data"
    
    # Capture this monitor at full resolution
    local temp_monitor_shot="$SCREENSHOT_DIR/.monitor_${monitor_index}_${timestamp}.jpg"
    run_with_timeout "$GRIM_TIMEOUT_S" grim -t jpeg -q "$JPEG_QUALITY" -o "$mon_name" "$temp_monitor_shot" 2>/dev/null || { monitor_index=$((monitor_index + 1)); continue; }
    
    if [[ ! -s "$temp_monitor_shot" ]]; then
      rm -f "$temp_monitor_shot"
      monitor_index=$((monitor_index + 1))
      continue
    fi
    
    # Convert to MPC cache (no scaling at this stage)
    local temp_monitor_mpc="$SCREENSHOT_DIR/.monitor_${monitor_index}_${timestamp}.mpc"
    run_with_timeout "$MAGICK_TIMEOUT_S" magick "$temp_monitor_shot" \
      -quality "$JPEG_QUALITY" \
      "$temp_monitor_mpc" 2>/dev/null || { rm -f "$temp_monitor_shot"; monitor_index=$((monitor_index + 1)); continue; }
    rm -f "$temp_monitor_shot"
    
    # Store MPC file and offset for this monitor
    monitor_mpc_files[$monitor_index]="$temp_monitor_mpc"
    monitor_offsets[$monitor_index]="${mon_x}|${mon_y}|${mon_width}|${mon_height}"
    
    monitor_index=$((monitor_index + 1))
  done < <(jq -r '.[] | [.name, .x, .y, .width, .height] | join("|")' <<< "$monitors_json")
  
  # Fetch all clients once - reused by the window loop and is_window_obscured
  local all_clients_json
  all_clients_json=$(printf 'j/clients' | nc -U "$HYPR_QUERY_SOCKET" 2>/dev/null)

  # Process each window (fields pre-joined by jq - no per-window fork)
  while IFS='|' read -r address mapped floating x y width height; do
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
    
    # Apply gap adjustments to crop dimensions (at full resolution)
    local crop_x=$(( relative_x + GAPS_IN ))
    local crop_y=$(( relative_y + GAPS_IN ))
    local crop_width=$(( width - 2 * GAPS_IN ))
    local crop_height=$(( height - 2 * GAPS_IN ))
    
    if [[ "$crop_width" -le 0 ]] || [[ "$crop_height" -le 0 ]]; then
      continue
    fi
    
    # Use fixed filename without timestamp
    local address_clean="${address#0x}"
    local filename="${address_clean}.jpg"
    local temp_output="$SCREENSHOT_DIR/.temp_${filename}"
    local output_path="$SCREENSHOT_DIR/$filename"
    
    # Check if window is obscured by a floating window (unless it's floating itself)
    local is_obscured=false
    if [[ "$floating" == "false" ]] && is_window_obscured "$x" "$y" "$width" "$height" "$current_workspace" "$all_clients_json"; then
      is_obscured=true
    fi
    
    # Only save if window is not obscured
    # This prevents capturing previews of windows hidden behind floating windows
    if [[ "$is_obscured" == "true" ]]; then
      continue
    fi

    # Crop at full resolution, then smart resize; simultaneously check brightness.
    # -write saves the JPEG while the pipeline continues to the Gray+info: stage.
    # The ">" flag means only shrink if larger, never enlarge.
    # This prevents upscaling small windows and maintains quality.
    local mean_brightness
    mean_brightness=$(run_with_timeout "$MAGICK_TIMEOUT_S" magick "$target_monitor_mpc" \
      -crop "${crop_width}x${crop_height}+${crop_x}+${crop_y}" \
      +repage \
      -resize "${PREVIEW_TARGET_MAX_WIDTH}x${PREVIEW_TARGET_HEIGHT}>" \
      -quality "$JPEG_QUALITY" \
      -define jpeg:dct-method=fast \
      -write "$temp_output" \
      -colorspace Gray \
      -format "%[fx:floor(mean*1000)]" info: 2>/dev/null || printf '')

    # Validate output exists and has content
    if [[ ! -s "$temp_output" ]]; then
      rm -f "$temp_output"
      continue
    fi

    # If brightness is very low (< 1% = <10 in 0-1000 scale), image is essentially black - discard it
    # This catches minimized windows, off-screen windows, or capture errors
    if [[ -n "$mean_brightness" ]] && (( mean_brightness < 10 )); then
      rm -f "$temp_output"
      continue
    fi

    # Only overwrite if validation passed
    mv "$temp_output" "$output_path"
  done < <(jq -r --arg ws "$current_workspace" '.[] | select(.workspace.id == ($ws | tonumber)) | [.address, (.mapped // true), .floating, .at[0], .at[1], .size[0], .size[1]] | join("|")' <<< "$all_clients_json" 2>/dev/null)
  
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

  maybe_run_healthcheck
  
  case $1 in
    activewindow\>\>*|activewindow,*)
      event_type="activewindow"
      ;;
    workspace\>\>*|workspace,*)
      event_type="workspace"
      ;;
    closewindow\>\>*|closewindow,*)
      # Delete stale thumbnail for the closed window
      local closed_address="${1#*>>}"; closed_address="${closed_address#*,}"
      rm -f "$SCREENSHOT_DIR/${closed_address}.jpg"
      return 0
      ;;
    *)
      return 0
      ;;
  esac
  
  # Check if a capture is already in progress
  if [[ -f "$CAPTURE_LOCK_FILE" ]]; then
    # Check if lock is stale (older than 10 seconds)
    local lock_ts; lock_ts=$(< "$CAPTURE_LOCK_FILE" 2>/dev/null) || lock_ts=0
    local now
    now=$(now_ms)
    local lock_age=$(( now - lock_ts ))
    if [[ $lock_age -lt 0 ]]; then
      rm -f "$CAPTURE_LOCK_FILE"
    elif [[ $lock_age -lt $LOCK_STALE_MS ]]; then
      # Fresh lock, skip this event
      return 0
    else
      # Stale lock, remove it and continue
      rm -f "$CAPTURE_LOCK_FILE"
    fi
  fi

  # Create lock with current timestamp
  local timestamp
  timestamp=$(now_ms)
  printf '%s\n' "$timestamp" > "$CAPTURE_LOCK_FILE"

  # Record this event
  printf '%s\n' "$timestamp" > "$LAST_EVENT_FILE"
  
  # Create unique capture ID for this event
  local capture_id="${timestamp}_${event_type}"
  printf '%s\n' "$capture_id" > "$WORKSPACE_CHANGE_FILE"
  
  # Get workspace and trigger screenshot
  local workspace_at_event
  workspace_at_event=$(printf 'j/activeworkspace' | nc -U "$HYPR_QUERY_SOCKET" 2>/dev/null | jq -r '.id')
  
  # Run capture inline to avoid accumulating background shells over long sessions
  capture_screenshot "$workspace_at_event" "$event_type" "$capture_id"
}

# Connect to Hyprland socket and process events
# Use 'true' to prevent set -e from killing the loop if handle_event returns non-zero
socat -U - "UNIX-CONNECT:$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock" \
  | while read -r line; do
      handle_event "$line" || true
    done

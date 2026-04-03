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
rm -f "$SCREENSHOT_DIR"/.temp_*.jpg

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

# Capture parallelism
MAX_PARALLEL_CAPTURES=4

# Black-frame guard (0-1000 scale). 10 ~= 1% mean brightness.
BLACK_FRAME_MEAN_THRESHOLD=10

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

  for file in "$SCREENSHOT_DIR"/.temp_*.jpg; do
    [[ -e "$file" ]] || continue

    mtime=$(stat -c %Y "$file" 2>/dev/null || printf '0')
    age=$((now_s - mtime))

    if [[ $age -gt $TEMP_FILE_MAX_AGE_S ]]; then
      rm -f "$file"
    fi
  done
}

cleanup_stale_preview_files() {
  local all_clients_json
  all_clients_json=$(printf 'j/clients' | nc -U "$HYPR_QUERY_SOCKET" 2>/dev/null)
  [[ -n "$all_clients_json" ]] || return 0

  declare -A live_preview_ids=()
  local live_id

  while read -r live_id; do
    [[ -n "$live_id" ]] || continue
    live_preview_ids["$live_id"]=1
  done < <(jq -r '.[] | [(.stableId // ""), ((.address // "") | sub("^0x"; ""))] | .[] | select(length > 0)' <<< "$all_clients_json" 2>/dev/null)

  local preview_path
  local preview_filename
  local preview_id
  for preview_path in "$SCREENSHOT_DIR"/*.jpg; do
    [[ -e "$preview_path" ]] || continue
    preview_filename="${preview_path##*/}"
    preview_id="${preview_filename%.jpg}"

    if [[ -n "${live_preview_ids[$preview_id]:-}" ]]; then
      continue
    fi

    rm -f "$preview_path"
  done
}

calculate_capture_scale() {
  local width="$1"
  local height="$2"

  awk -v w="$width" \
      -v h="$height" \
      -v max_w="$PREVIEW_TARGET_MAX_WIDTH" \
      -v max_h="$PREVIEW_TARGET_HEIGHT" \
      'BEGIN {
        if (w <= 0 || h <= 0) {
          printf "1.0\n"
          exit
        }

        scale_w = max_w / w
        scale_h = max_h / h
        scale = (scale_w < scale_h) ? scale_w : scale_h

        if (scale > 1.0) {
          scale = 1.0
        }

        if (scale <= 0.0) {
          scale = 1.0
        }

        printf "%.4f\n", scale
      }'
}

is_frame_too_dark() {
  local image_path="$1"

  if command -v magick >/dev/null 2>&1; then
    local mean_brightness
    mean_brightness=$(run_with_timeout 1 magick "$image_path" -colorspace Gray -format "%[fx:floor(mean*1000)]" info: 2>/dev/null || printf '')
    if [[ -n "$mean_brightness" ]] && (( mean_brightness < BLACK_FRAME_MEAN_THRESHOLD )); then
      return 0
    fi
  fi

  return 1
}

capture_window_preview() {
  local preview_id="$1"
  local width="$2"
  local height="$3"

  if [[ -z "$preview_id" ]]; then
    return 0
  fi

  if [[ "$width" -le 0 ]] || [[ "$height" -le 0 ]]; then
    return 0
  fi

  local scale_factor
  scale_factor=$(calculate_capture_scale "$width" "$height")
  if [[ -z "$scale_factor" ]]; then
    return 0
  fi

  local filename="${preview_id}.jpg"
  local temp_output="$SCREENSHOT_DIR/.temp_${filename}"
  local output_path="$SCREENSHOT_DIR/$filename"

  run_with_timeout "$GRIM_TIMEOUT_S" grim \
    -t jpeg \
    -q "$JPEG_QUALITY" \
    -s "$scale_factor" \
    -T "$preview_id" \
    "$temp_output" 2>/dev/null || {
      rm -f "$temp_output"
      return 0
    }

  if [[ ! -s "$temp_output" ]]; then
    rm -f "$temp_output"
    return 0
  fi

  if is_frame_too_dark "$temp_output"; then
    rm -f "$temp_output"
    return 0
  fi

  mv "$temp_output" "$output_path"
}

wait_for_capture_batch() {
  local pid
  for pid in "$@"; do
    wait "$pid" || true
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
  cleanup_stale_preview_files
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

# Capture all windows in the active workspace using Hyprland toplevel export.
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
  
  # Fetch all clients once for this capture pass.
  local all_clients_json
  all_clients_json=$(printf 'j/clients' | nc -U "$HYPR_QUERY_SOCKET" 2>/dev/null)
  [[ -n "$all_clients_json" ]] || return 0

  # Process each window in the target workspace.
  local -a capture_pids=()
  while IFS=$'\t' read -r preview_id mapped width height; do
    [[ "$mapped" == "false" ]] && continue
    [[ -n "$preview_id" ]] || continue
    capture_window_preview "$preview_id" "$width" "$height" &
    capture_pids+=("$!")

    if [[ ${#capture_pids[@]} -ge $MAX_PARALLEL_CAPTURES ]]; then
      wait_for_capture_batch "${capture_pids[@]}"
      capture_pids=()
    fi
  done < <(jq -r --arg ws "$current_workspace" '.[] | select(.workspace.id == ($ws | tonumber)) | [((.stableId // "") | if length > 0 then . else ((.address // "") | sub("^0x"; "")) end), (.mapped // true), (.size[0] // 0), (.size[1] // 0)] | @tsv' <<< "$all_clients_json" 2>/dev/null)

  if [[ ${#capture_pids[@]} -gt 0 ]]; then
    wait_for_capture_batch "${capture_pids[@]}"
  fi

  cleanup_stale_preview_files
  
  # Release lock
  rm -f "$CAPTURE_LOCK_FILE"
}

# Handle Hyprland IPC events
handle_event() {
  local event_type=""

  maybe_run_healthcheck
  
  case $1 in
    activewindow\>\>*|activewindow,*|activewindowv2\>\>*|activewindowv2,*)
      event_type="activewindow"
      ;;
    workspace\>\>*|workspace,*|workspacev2\>\>*|workspacev2,*)
      event_type="workspace"
      ;;
    openwindow\>\>*|openwindow,*|openwindowv2\>\>*|openwindowv2,*)
      event_type="windowupdate"
      ;;
    movewindow\>\>*|movewindow,*|movewindowv2\>\>*|movewindowv2,*)
      event_type="windowupdate"
      ;;
    changefloatingmode\>\>*|changefloatingmode,*)
      event_type="windowupdate"
      ;;
    fullscreen\>\>*|fullscreen,*|fullscreenv2\>\>*|fullscreenv2,*)
      event_type="windowupdate"
      ;;
    closewindow\>\>*|closewindow,*)
      # Close event only includes address; refresh preview set from live clients.
      cleanup_stale_preview_files
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

#!/usr/bin/env bash

set -euo pipefail

readonly MINIMIZED_WORKSPACE="special:minimized"
readonly STATE_FILE="${XDG_RUNTIME_DIR}/hypr-minimized-state.json"
readonly DAEMON_SCRIPT="$HOME/.config/hypr/scripts/minimized-state-daemon.sh"

bucket_key_for() {
  local monitor_name="$1"
  local workspace_name="$2"

  if [[ -z "$monitor_name" || -z "$workspace_name" ]]; then
    return
  fi

  printf '%s__%s' "$monitor_name" "$workspace_name"
}

init_state_file() {
  if [[ -f "$STATE_FILE" ]]; then
    return
  fi

  printf '{}\n' > "$STATE_FILE"
}

ensure_daemon_running() {
  if pgrep -f "[m]inimized-state-daemon.sh" >/dev/null 2>&1; then
    return
  fi

  if command -v uwsm-app >/dev/null 2>&1; then
    uwsm-app -s b -- "$DAEMON_SCRIPT" >/dev/null 2>&1 &
    return
  fi

  "$DAEMON_SCRIPT" >/dev/null 2>&1 &
}

save_window_state() {
  local window_json="$1"
  local address workspace_name monitor_id floating x y width height monitor_name bucket
  local temp_file

  address="$(jq -r '.address // empty' <<< "$window_json")"
  workspace_name="$(jq -r '.workspace.name // empty' <<< "$window_json")"
  monitor_id="$(jq -r '.monitor // empty' <<< "$window_json")"
  floating="$(jq -r '.floating // false' <<< "$window_json")"
  x="$(jq -r '.at[0] // 0' <<< "$window_json")"
  y="$(jq -r '.at[1] // 0' <<< "$window_json")"
  width="$(jq -r '.size[0] // 0' <<< "$window_json")"
  height="$(jq -r '.size[1] // 0' <<< "$window_json")"
  monitor_name="$(hyprctl monitors -j 2>/dev/null | jq -r --argjson id "$monitor_id" 'first(.[] | select(.id == $id) | .name) // empty')"
  bucket="$(bucket_key_for "$monitor_name" "$workspace_name")"

  if [[ -z "$address" || -z "$workspace_name" ]]; then
    return
  fi

  temp_file="$(mktemp)"
  jq \
    --arg address "$address" \
    --arg workspace "$workspace_name" \
    --arg monitor "$monitor_name" \
    --arg bucket "$bucket" \
    --argjson floating "$floating" \
    --argjson x "$x" \
    --argjson y "$y" \
    --argjson width "$width" \
    --argjson height "$height" \
    '.[$address] = {
      workspace: $workspace,
      monitor: $monitor,
      bucket: $bucket,
      floating: $floating,
      x: $x,
      y: $y,
      width: $width,
      height: $height
    }' "$STATE_FILE" > "$temp_file"
  mv "$temp_file" "$STATE_FILE"
}

clear_window_state() {
  local address="$1"
  local temp_file

  if [[ -z "$address" ]]; then
    return
  fi

  temp_file="$(mktemp)"
  jq --arg address "$address" 'del(.[$address])' "$STATE_FILE" > "$temp_file"
  mv "$temp_file" "$STATE_FILE"
}

restore_window_state() {
  local address="$1"
  local state_json workspace_name monitor_name floating x y width height

  state_json="$(jq -c --arg address "$address" '.[$address] // empty' "$STATE_FILE")"
  if [[ -z "$state_json" ]]; then
    hyprctl dispatch movetoworkspacesilent +0
    return
  fi

  workspace_name="$(jq -r '.workspace // empty' <<< "$state_json")"
  monitor_name="$(jq -r '.monitor // empty' <<< "$state_json")"
  floating="$(jq -r '.floating // false' <<< "$state_json")"
  x="$(jq -r '.x // 0' <<< "$state_json")"
  y="$(jq -r '.y // 0' <<< "$state_json")"
  width="$(jq -r '.width // 0' <<< "$state_json")"
  height="$(jq -r '.height // 0' <<< "$state_json")"

  if [[ -n "$workspace_name" ]]; then
    hyprctl dispatch movetoworkspacesilent "$workspace_name" >/dev/null
  else
    hyprctl dispatch movetoworkspacesilent +0 >/dev/null
  fi

  if [[ -n "$monitor_name" ]]; then
    hyprctl dispatch focusmonitor "$monitor_name" >/dev/null
  fi

  hyprctl dispatch focuswindow "address:$address" >/dev/null

  if [[ "$floating" == "true" ]]; then
    hyprctl dispatch resizewindowpixel "exact $width $height,address:$address" >/dev/null
    hyprctl dispatch movewindowpixel "exact $x $y,address:$address" >/dev/null
  fi

  clear_window_state "$address"
}

active_window_json="$(hyprctl activewindow -j 2>/dev/null || true)"
active_workspace="$(printf '%s' "$active_window_json" | jq -r '.workspace.name // empty' 2>/dev/null || true)"
active_address="$(printf '%s' "$active_window_json" | jq -r '.address // empty' 2>/dev/null || true)"

if [[ -z "$active_address" ]]; then
  exit 0
fi

init_state_file
ensure_daemon_running

if [[ "$active_workspace" == "$MINIMIZED_WORKSPACE" ]]; then
  restore_window_state "$active_address"
  exit 0
fi

save_window_state "$active_window_json"
hyprctl dispatch movetoworkspacesilent "$MINIMIZED_WORKSPACE" >/dev/null

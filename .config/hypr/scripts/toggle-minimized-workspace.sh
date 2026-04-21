#!/usr/bin/env bash

set -euo pipefail

readonly MINIMIZED_WORKSPACE_PREFIX="special:minimized"
readonly GAMING_WORKSPACE="10"
readonly GAMING_OVERLAY_WORKSPACE="special:gaming-overlay"
readonly STATE_FILE="${XDG_RUNTIME_DIR}/hypr-minimized-state.json"
target_address="${1:-}"

init_state_file() {
  if [[ -f "$STATE_FILE" ]]; then
    if jq -e 'type == "object"' "$STATE_FILE" >/dev/null 2>&1; then
      return
    fi
  fi

  printf '{}\n' > "$STATE_FILE"
}

bucket_key_for() {
  local monitor_name="$1"
  local workspace_name="$2"

  if [[ -z "$monitor_name" || -z "$workspace_name" ]]; then
    return
  fi

  printf '%s__%s' "$monitor_name" "$workspace_name"
}

special_workspace_for_bucket() {
  local bucket_key="$1"
  local bucket_hash

  if [[ -z "$bucket_key" ]]; then
    printf '%s\n' "$MINIMIZED_WORKSPACE_PREFIX"
    return
  fi

  bucket_hash="$(printf '%s' "$bucket_key" | sha1sum | cut -c1-12)"
  printf '%s\n' "${MINIMIZED_WORKSPACE_PREFIX}-${bucket_hash}"
}

state_value_for_address() {
  local address="$1"
  local field="$2"

  if [[ -z "$address" || -z "$field" || ! -f "$STATE_FILE" ]]; then
    return
  fi

  jq -r --arg address "$address" --arg field "$field" '.[$address][$field] // empty' "$STATE_FILE" 2>/dev/null || true
}

bucket_has_windows() {
  local bucket_key="$1"

  if [[ -z "$bucket_key" || ! -f "$STATE_FILE" ]]; then
    printf '0\n'
    return
  fi

  jq -r --arg bucket "$bucket_key" '
    [
      to_entries[]
      | select(.value.bucket == $bucket)
    ]
    | length
  ' "$STATE_FILE" 2>/dev/null || printf '0\n'
}

special_workspace_for_bucket_from_state() {
  local bucket_key="$1"

  if [[ -z "$bucket_key" || ! -f "$STATE_FILE" ]]; then
    return
  fi

  jq -r --arg bucket "$bucket_key" '
    first([
      to_entries[]
      | select(.value.bucket == $bucket)
      | .value.special
      | select(. != null and . != "")
    ]) // empty
  ' "$STATE_FILE" 2>/dev/null || true
}

live_windows_in_special() {
  local special_workspace="$1"

  if [[ -z "$special_workspace" ]]; then
    printf '0\n'
    return
  fi

  hyprctl clients -j 2>/dev/null | jq -r --arg ws "$special_workspace" '[.[] | select(.workspace.name == $ws)] | length'
}

monitor_for_special_workspace() {
  local special_workspace="$1"

  if [[ -z "$special_workspace" || ! -f "$STATE_FILE" ]]; then
    return
  fi

  jq -r --arg special "$special_workspace" '
    first([
      to_entries[]
      | select((.value.special // "special:minimized") == $special)
      | .value.monitor
    ] | map(select(. != ""))) // empty
  ' "$STATE_FILE" 2>/dev/null || true
}

visible_special_workspace() {
  hyprctl monitors -j 2>/dev/null | jq -r --arg prefix "$MINIMIZED_WORKSPACE_PREFIX" '
    first(
      .[]
      | .specialWorkspace.name
      | select(startswith($prefix))
    ) // empty
  '
}

visible_special_monitor() {
  local special_workspace="$1"

  if [[ -z "$special_workspace" ]]; then
    return
  fi

  hyprctl monitors -j 2>/dev/null | jq -r --arg special "$special_workspace" '
    first(.[] | select(.specialWorkspace.name == $special) | .name) // empty
  '
}

toggle_special_workspace_on_monitor() {
  local monitor_name="$1"
  local special_workspace="$2"
  local special_name

  if [[ -z "$special_workspace" ]]; then
    return
  fi

  special_name="${special_workspace#special:}"

  if [[ -z "$monitor_name" ]]; then
    hyprctl dispatch togglespecialworkspace "$special_name" >/dev/null
    return
  fi

  hyprctl --batch "dispatch focusmonitor $monitor_name ; dispatch togglespecialworkspace $special_name" >/dev/null
}

focused_monitor_json="$(hyprctl monitors -j 2>/dev/null | jq -c 'first(.[] | select(.focused == true)) // empty')"
init_state_file
current_monitor="$(jq -r '.name // empty' <<< "$focused_monitor_json")"
current_workspace="$(jq -r '.activeWorkspace.name // empty' <<< "$focused_monitor_json")"

if [[ -z "$target_address" ]]; then
  if [[ "$current_workspace" == "$GAMING_WORKSPACE" || "$current_workspace" == "$GAMING_OVERLAY_WORKSPACE" ]]; then
    toggle_special_workspace_on_monitor "$current_monitor" "$GAMING_OVERLAY_WORKSPACE"
    exit 0
  fi
fi

current_bucket=""
desired_special_workspace=""
desired_monitor=""

if [[ -n "$current_monitor" && -n "$current_workspace" && "$current_workspace" != special:* ]]; then
  current_bucket="$(bucket_key_for "$current_monitor" "$current_workspace")"
  desired_special_workspace="$(special_workspace_for_bucket "$current_bucket")"
  desired_monitor="$current_monitor"
fi

if [[ -n "$target_address" ]]; then
  desired_special_workspace="$(state_value_for_address "$target_address" "special")"
  desired_monitor="$(state_value_for_address "$target_address" "monitor")"

  if [[ -z "$desired_special_workspace" ]]; then
    desired_special_workspace="$(hyprctl clients -j 2>/dev/null | jq -r --arg address "$target_address" --arg prefix "$MINIMIZED_WORKSPACE_PREFIX" 'first(.[] | select(.address == $address) | .workspace.name | select(startswith($prefix))) // empty')"
  fi

  if [[ -z "$desired_special_workspace" ]]; then
    target_bucket="$(state_value_for_address "$target_address" "bucket")"
    desired_special_workspace="$(special_workspace_for_bucket "$target_bucket")"
  fi

  if [[ -z "$desired_monitor" ]]; then
    desired_monitor="$(monitor_for_special_workspace "$desired_special_workspace")"
  fi
fi

visible_special="$(visible_special_workspace)"
visible_monitor="$(visible_special_monitor "$visible_special")"

if [[ -n "$visible_special" ]]; then
  if [[ -n "$desired_special_workspace" && "$desired_special_workspace" != "$visible_special" ]]; then
    if [[ -n "$target_address" ]]; then
      toggle_special_workspace_on_monitor "$visible_monitor" "$visible_special"
      toggle_special_workspace_on_monitor "$desired_monitor" "$desired_special_workspace"
      exit 0
    fi

    current_bucket_count="$(bucket_has_windows "$current_bucket")"
    desired_live_count="$(live_windows_in_special "$desired_special_workspace")"
    if [[ "$current_bucket_count" != "0" || "$desired_live_count" != "0" ]]; then
      toggle_special_workspace_on_monitor "$visible_monitor" "$visible_special"
      toggle_special_workspace_on_monitor "$desired_monitor" "$desired_special_workspace"
      exit 0
    fi
  fi

  toggle_special_workspace_on_monitor "$visible_monitor" "$visible_special"
  exit 0
fi

if [[ -n "$target_address" ]]; then
  if [[ -n "$desired_special_workspace" ]]; then
    toggle_special_workspace_on_monitor "$desired_monitor" "$desired_special_workspace"
  fi
  exit 0
fi

if [[ -z "$current_bucket" || -z "$desired_special_workspace" ]]; then
  exit 0
fi

current_bucket_count="$(bucket_has_windows "$current_bucket")"
desired_live_count="$(live_windows_in_special "$desired_special_workspace")"
if [[ "$current_bucket_count" != "0" || "$desired_live_count" != "0" ]]; then
  toggle_special_workspace_on_monitor "$desired_monitor" "$desired_special_workspace"
fi

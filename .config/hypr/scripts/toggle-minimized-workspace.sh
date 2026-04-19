#!/usr/bin/env bash

set -euo pipefail

readonly MINIMIZED_WORKSPACE="special:minimized"
readonly MINIMIZED_NAME="minimized"
readonly STATE_FILE="${XDG_RUNTIME_DIR}/hypr-minimized-state.json"

visible_monitor="$(
  hyprctl monitors -j 2>/dev/null | jq -r --arg full "$MINIMIZED_WORKSPACE" --arg short "$MINIMIZED_NAME" '
    first(.[] | select(.specialWorkspace.name == $full or .specialWorkspace.name == $short) | .name) // empty
  '
)"

if [[ -n "$visible_monitor" ]]; then
  hyprctl --batch "dispatch focusmonitor $visible_monitor ; dispatch togglespecialworkspace $MINIMIZED_NAME" >/dev/null
  exit 0
fi

clients_json="$(hyprctl clients -j 2>/dev/null || printf '[]\n')"
state_json='{}'
if [[ -f "$STATE_FILE" ]]; then
  state_json="$(jq -c '.' "$STATE_FILE" 2>/dev/null || printf '{}\n')"
fi

target_monitor="$(
  jq -r --arg ws "$MINIMIZED_WORKSPACE" --argjson state "$state_json" '
    [ .[] | select(.workspace.name == $ws) | .address ] as $addresses
    | reduce $addresses[] as $address ({};
        ($state[$address].monitor // "") as $monitor
        | if $monitor == "" then . else .[$monitor] = ((.[$monitor] // 0) + 1) end
      )
    | to_entries
    | sort_by(-.value)
    | first
    | .key // empty
  ' <<< "$clients_json"
)"

if [[ -n "$target_monitor" ]]; then
  hyprctl --batch "dispatch focusmonitor $target_monitor ; dispatch togglespecialworkspace $MINIMIZED_NAME" >/dev/null
  exit 0
fi

target_monitor_id="$(
  jq -r --arg ws "$MINIMIZED_WORKSPACE" '[ .[] | select(.workspace.name == $ws) | .monitor ] | first // empty' <<< "$clients_json"
)"

if [[ -n "$target_monitor_id" ]]; then
  target_monitor="$(hyprctl monitors -j 2>/dev/null | jq -r --argjson id "$target_monitor_id" 'first(.[] | select(.id == $id) | .name) // empty')"
  if [[ -n "$target_monitor" ]]; then
    hyprctl --batch "dispatch focusmonitor $target_monitor ; dispatch togglespecialworkspace $MINIMIZED_NAME" >/dev/null
    exit 0
  fi
fi

hyprctl dispatch togglespecialworkspace "$MINIMIZED_NAME" >/dev/null

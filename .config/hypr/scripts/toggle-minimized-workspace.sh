#!/usr/bin/env bash

set -euo pipefail

readonly MINIMIZED_WORKSPACE="special:minimized"
readonly MINIMIZED_NAME="minimized"
readonly STATE_FILE="${XDG_RUNTIME_DIR}/hypr-minimized-state.json"
target_address="${1:-}"

monitor_from_state() {
  local address="$1"

  if [[ -z "$address" || ! -f "$STATE_FILE" ]]; then
    return
  fi

  jq -r --arg address "$address" '.[$address].monitor // empty' "$STATE_FILE" 2>/dev/null || true
}

monitor_from_client_position() {
  local address="$1"

  if [[ -z "$address" ]]; then
    return
  fi

  local clients_json monitors_json
  clients_json="$(hyprctl clients -j 2>/dev/null || printf '[]\n')"
  monitors_json="$(hyprctl monitors -j 2>/dev/null || printf '[]\n')"

  jq -r --arg address "$address" --argjson monitors "$monitors_json" '
    first(.[] | select(.address == $address)) as $client
    | if $client == null then
        ""
      else
        ($client.at[0] // 0) as $x
        | ($client.at[1] // 0) as $y
        | first(
            $monitors[]
            | select($x >= .x and $x < (.x + .width) and $y >= .y and $y < (.y + .height))
            | .name
          ) // ""
      end
  ' <<< "$clients_json"
}

show_on_monitor() {
  local monitor_name="$1"

  if [[ -z "$monitor_name" ]]; then
    hyprctl dispatch togglespecialworkspace "$MINIMIZED_NAME" >/dev/null
    return
  fi

  hyprctl --batch "dispatch focusmonitor $monitor_name ; dispatch togglespecialworkspace $MINIMIZED_NAME" >/dev/null
}

visible_monitor="$(
  hyprctl monitors -j 2>/dev/null | jq -r --arg full "$MINIMIZED_WORKSPACE" --arg short "$MINIMIZED_NAME" '
    first(.[] | select(.specialWorkspace.name == $full or .specialWorkspace.name == $short) | .name) // empty
  '
)"

target_monitor="$(monitor_from_state "$target_address")"
if [[ -z "$target_monitor" ]]; then
  target_monitor="$(monitor_from_client_position "$target_address")"
fi

if [[ -n "$target_monitor" ]]; then
  if [[ -n "$visible_monitor" && "$visible_monitor" != "$target_monitor" ]]; then
    show_on_monitor "$visible_monitor"
  fi

  if [[ -z "$visible_monitor" || "$visible_monitor" != "$target_monitor" ]]; then
    show_on_monitor "$target_monitor"
  fi

  exit 0
fi

if [[ -n "$visible_monitor" ]]; then
  show_on_monitor "$visible_monitor"
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
  show_on_monitor "$target_monitor"
  exit 0
fi

target_monitor_id="$(
  jq -r --arg ws "$MINIMIZED_WORKSPACE" '[ .[] | select(.workspace.name == $ws) | .monitor ] | first // empty' <<< "$clients_json"
)"

if [[ -n "$target_monitor_id" ]]; then
  target_monitor="$(hyprctl monitors -j 2>/dev/null | jq -r --argjson id "$target_monitor_id" 'first(.[] | select(.id == $id) | .name) // empty')"
  if [[ -n "$target_monitor" ]]; then
    show_on_monitor "$target_monitor"
    exit 0
  fi
fi

hyprctl dispatch togglespecialworkspace "$MINIMIZED_NAME" >/dev/null

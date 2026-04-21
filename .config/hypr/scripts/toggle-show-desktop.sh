#!/usr/bin/env bash

set -euo pipefail

readonly SPECIAL_WORKSPACE="special:desktop"
readonly STATE_DIR="${XDG_RUNTIME_DIR:-/tmp}/hypr-show-desktop"

mkdir -p "$STATE_DIR"

focused_monitor_json="$(hyprctl monitors -j | jq -c 'first(.[] | select(.focused == true)) // empty')"

if [[ -z "$focused_monitor_json" ]]; then
  exit 0
fi

focused_monitor_id="$(jq -r '.id // empty' <<< "$focused_monitor_json")"
focused_monitor_name="$(jq -r '.name // empty' <<< "$focused_monitor_json")"
current_workspace="$(jq -r '.activeWorkspace.name // empty' <<< "$focused_monitor_json")"

if [[ -z "$focused_monitor_id" || -z "$focused_monitor_name" || -z "$current_workspace" ]]; then
  exit 0
fi

if [[ "$current_workspace" == special:* ]]; then
  exit 0
fi

state_file="${STATE_DIR}/${focused_monitor_name}__${current_workspace}"

if [[ -s "$state_file" ]]; then
  mapfile -t addresses < "$state_file"
  commands=""

  for address in "${addresses[@]}"; do
    if [[ -z "$address" ]]; then
      continue
    fi

    commands+="dispatch movetoworkspacesilent name:${current_workspace},address:${address};"
  done

  if [[ -n "$commands" ]]; then
    hyprctl --batch "$commands" >/dev/null
  fi

  rm -f "$state_file"
  exit 0
fi

mapfile -t addresses < <(
  hyprctl clients -j | jq -r --arg ws "$current_workspace" --argjson monitor "$focused_monitor_id" '
    .[]
    | select(.workspace.name == $ws and .monitor == $monitor)
    | .address
  '
)

if [[ ${#addresses[@]} -eq 0 ]]; then
  exit 0
fi

commands=""

for address in "${addresses[@]}"; do
  if [[ -z "$address" ]]; then
    continue
  fi

  commands+="dispatch movetoworkspacesilent ${SPECIAL_WORKSPACE},address:${address};"
done

if [[ -n "$commands" ]]; then
  hyprctl --batch "$commands" >/dev/null
fi

printf '%s\n' "${addresses[@]}" > "$state_file"

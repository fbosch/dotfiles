#!/usr/bin/env bash

set -euo pipefail

# shellcheck disable=SC1091
source "${HOME}/.config/hypr/runtime/lib/hypr-ipc.sh"

readonly SPECIAL_WORKSPACE="special:desktop"
readonly STATE_DIR="${XDG_RUNTIME_DIR:-/tmp}/hypr-show-desktop"

mkdir -p "$STATE_DIR"

lua_quote() {
  jq -Rn --arg value "$1" '$value'
}

move_window_to_workspace() {
  local workspace="$1"
  local address="$2"

  hypr_dispatch_lua "hl.dsp.window.move({ workspace = $(lua_quote "$workspace"), window = $(lua_quote "address:${address}"), follow = false })"
}

focus_window() {
  local address="$1"

  hypr_dispatch_lua "hl.dsp.focus({ window = $(lua_quote "address:${address}") })"
}

resize_window() {
  local address="$1"
  local width="$2"
  local height="$3"

  hypr_dispatch_lua "hl.dsp.window.resize({ x = ${width}, y = ${height}, window = $(lua_quote "address:${address}") })"
}

move_window() {
  local address="$1"
  local x="$2"
  local y="$3"

  hypr_dispatch_lua "hl.dsp.window.move({ x = ${x}, y = ${y}, window = $(lua_quote "address:${address}") })"
}

focused_monitor_json="$(hypr_query 'j/monitors' | jq -c 'first(.[] | select(.focused == true)) // empty')"

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
  target_workspace="$(jq -r '.workspace // empty' "$state_file" 2>/dev/null || true)"

  if [[ -z "$target_workspace" ]]; then
    target_workspace="$current_workspace"
  fi

  mapfile -t addresses < <(jq -r '.windows[]?.address // empty' "$state_file" 2>/dev/null || true)
  for address in "${addresses[@]}"; do
    if [[ -z "$address" ]]; then
      continue
    fi

    move_window_to_workspace "name:${target_workspace}" "$address"
  done

  while IFS=$'\t' read -r address x y width height; do
    if [[ -z "$address" ]]; then
      continue
    fi

    hypr_dispatch_lua_batch \
      "hl.dsp.focus({ window = $(lua_quote "address:${address}") })" \
      "hl.dsp.window.resize({ x = ${width}, y = ${height}, window = $(lua_quote "address:${address}") })" \
      "hl.dsp.window.move({ x = ${x}, y = ${y}, window = $(lua_quote "address:${address}") })" \
      2>/dev/null || true
  done < <(
    jq -r '.windows[]? | select(.floating == true) | "\(.address)\t\(.x)\t\(.y)\t\(.width)\t\(.height)"' "$state_file" 2>/dev/null || true
  )

  rm -f "$state_file"
  exit 0
fi

windows_json="$({
  hypr_query 'j/clients' | jq -c --arg ws "$current_workspace" --argjson monitor "$focused_monitor_id" '
    [
      .[]
      | select(.workspace.name == $ws and .monitor == $monitor)
      | {
          address: .address,
          floating: (.floating // false),
          x: (.at[0] // 0),
          y: (.at[1] // 0),
          width: (.size[0] // 0),
          height: (.size[1] // 0)
        }
    ]
  '
} 2>/dev/null || printf '[]\n')"

mapfile -t addresses < <(jq -r '.[]?.address // empty' <<< "$windows_json")

if [[ ${#addresses[@]} -eq 0 ]]; then
  exit 0
fi

jq -n \
  --arg monitor "$focused_monitor_name" \
  --arg workspace "$current_workspace" \
  --argjson windows "$windows_json" \
  '{monitor: $monitor, workspace: $workspace, windows: $windows}' > "$state_file"

for address in "${addresses[@]}"; do
  if [[ -z "$address" ]]; then
    continue
  fi

  move_window_to_workspace "$SPECIAL_WORKSPACE" "$address"
done

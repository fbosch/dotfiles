#!/usr/bin/env bash

set -euo pipefail

app_id="${1:-}"
mode="${2:-open}"
taskbar_apps_file="${TASKBAR_APPS_FILE:-${HOME}/.config/hypr/taskbar/apps.json}"
clients_json_cache=""

# shellcheck disable=SC1091
source "${HOME}/.config/hypr/runtime/lib/hypr-ipc.sh"

lua_quote() {
  local value="$1"

  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '"%s"' "$value"
}

clients_json() {
  if [[ -z "$clients_json_cache" ]]; then
    clients_json_cache="$(hypr_query j/clients)"
  fi

  printf '%s\n' "$clients_json_cache"
}

invalidate_clients_json() {
  clients_json_cache=""
}

if [[ "$app_id" == "--any-open" ]]; then
  clients_json \
    | jq -e --slurpfile apps "$taskbar_apps_file" '
      def app_matches($window; $app): $app.class == $window.class;
      any(.[]; . as $window |
        any($apps[0][]; app_matches($window; .) and $window.pinned == true and $window.workspace.name != .workspace)
      )
    ' >/dev/null

  exit $?
fi

kill_all() {
  clients_json \
    | jq -r --slurpfile apps "$taskbar_apps_file" '
      def app_matches($window; $app): $app.class == $window.class;
      .[] as $window |
      $apps[0][] |
      select(app_matches($window; .) and $window.workspace.name == .workspace) |
      $window.address
    ' \
    | sort -u \
    | while IFS= read -r address; do
      [[ -z "$address" ]] && continue
      hypr_dispatch_lua "hl.dsp.window.close($(lua_quote "address:${address}"))" || true
      invalidate_clients_json
    done
}

park_other_visible_apps() {
  local current_id="$1"

  clients_json \
    | jq -r --slurpfile apps "$taskbar_apps_file" --arg current_id "$current_id" '
      def app_matches($window; $app): $app.class == $window.class;
      .[] as $window |
      $apps[0][] |
      select(.id != $current_id) |
      select(app_matches($window; .) and $window.pinned == true and $window.workspace.name != .workspace) |
      "\($window.address)|\(.workspace)"
    ' \
    | while IFS='|' read -r address target_workspace; do
      [[ -z "$address" || -z "$target_workspace" ]] && continue
      hypr_dispatch_lua "hl.dsp.window.pin({ window = $(lua_quote "address:${address}") })" || true
      hypr_dispatch_lua "hl.dsp.window.move({ workspace = $(lua_quote "$target_workspace"), window = $(lua_quote "address:${address}"), follow = false })" || true
      invalidate_clients_json
    done
}

park_active() {
  local active address workspace pinned

  active="$(hypr_query j/activewindow || printf '{}')"
  address="$(jq -r '.address // empty' <<< "$active")"
  workspace="$(jq -r --argjson active "$active" '
    def app_matches($window; $app): $app.class == $window.class;
    first(.[] | select(app_matches($active; .)) | .workspace) // empty
  ' "$taskbar_apps_file")"

  [[ -z "$address" || -z "$workspace" ]] && return 1

  pinned="$(jq -r '.pinned // false' <<< "$active")"
  if [[ "$pinned" == "true" ]]; then
    hypr_dispatch_lua "hl.dsp.window.pin({ window = $(lua_quote "address:${address}") })" || true
  fi

  hypr_dispatch_lua "hl.dsp.window.move({ workspace = $(lua_quote "$workspace"), window = $(lua_quote "address:${address}"), follow = false })" || true
}

if [[ "$app_id" == "--park-active" ]]; then
  park_active
  exit $?
fi

if [[ "$app_id" == "--kill-all" ]]; then
  kill_all
  exit 0
fi

load_app() {
  local app_json="$1"

  class_name="$(jq -r '.class' <<< "$app_json")"
  tag="$(jq -r '.tag // empty' <<< "$app_json")"
  workspace="$(jq -r '.workspace' <<< "$app_json")"
  width="$(jq -r '.saved_size[0] // .rule_size[0] // empty' <<< "$app_json")"
  height="$(jq -r '.saved_size[1] // .rule_size[1] // empty' <<< "$app_json")"
  mapfile -t command < <(jq -r --arg home "$HOME" '.command[] | gsub("__HOME__"; $home)' <<< "$app_json")

  unset fallback_command
  if jq -e '.fallback_command' <<< "$app_json" >/dev/null; then
    mapfile -t fallback_command < <(jq -r --arg home "$HOME" '.fallback_command[] | gsub("__HOME__"; $home)' <<< "$app_json")
  fi
}

app_json="$(jq -c --arg id "$app_id" 'first(.[] | select(.id == $id)) // empty' "$taskbar_apps_file")"
[[ -z "$app_json" ]] && exit 1
load_app "$app_json"

shell_quote() {
  printf "'%s'" "${1//\'/\'\\\'\'}"
}

command_line() {
  local part line=""

  for part in "$@"; do
    if [[ -n "$line" ]]; then
      line+=" "
    fi
    line+="$(shell_quote "$part")"
  done

  printf '%s\n' "$line"
}

client_address() {
  clients_json \
    | jq -r --arg class_name "$class_name" 'first(.[] | select(.class == $class_name) | .address) // empty'
}

move_window_to_workspace() {
  local address="$1"
  local target_workspace="$2"

  hypr_dispatch_lua "hl.dsp.window.move({ workspace = $(lua_quote "$target_workspace"), window = $(lua_quote "address:${address}"), follow = false })" || true
  invalidate_clients_json
}

pin_window() {
  local address="$1"

  hypr_dispatch_lua "hl.dsp.window.pin({ window = $(lua_quote "address:${address}") })" || true
  invalidate_clients_json
}

float_window() {
  local address="$1"

  hypr_dispatch_lua "hl.dsp.window.float({ window = $(lua_quote "address:${address}") })" || true
  invalidate_clients_json
}

active_workspace() {
  hypr_query j/activeworkspace | jq -r '.name // empty'
}

current_monitor() {
  local cursor_x cursor_y monitors

  IFS=',' read -r cursor_x cursor_y <<< "$(hypr_query cursorpos || true)"
  cursor_x="${cursor_x## }"
  cursor_y="${cursor_y## }"
  monitors="$(hypr_query j/monitors)"

  if [[ -n "$cursor_x" && -n "$cursor_y" ]]; then
    jq -c --argjson cursor_x "$cursor_x" --argjson cursor_y "$cursor_y" '
      def logical_width: if (.transform == 1 or .transform == 3) then .height else .width end;
      def logical_height: if (.transform == 1 or .transform == 3) then .width else .height end;
      first(.[] | select(
        $cursor_x >= .x and $cursor_x < (.x + logical_width) and
        $cursor_y >= .y and $cursor_y < (.y + logical_height)
      )) // empty
    ' <<< "$monitors"
    return
  fi

  local active_monitor_name
  active_monitor_name="$(hypr_query j/activeworkspace | jq -r '.monitor // empty')"
  jq -c --arg name "$active_monitor_name" 'first(.[] | select(.name == $name)) // empty' <<< "$monitors"
}

target_workspace() {
  local monitor="${1:-}"

  if (( $# == 0 )); then
    monitor="$(current_monitor)"
  fi

  if [[ -n "$monitor" ]]; then
    jq -r '.activeWorkspace.name // empty' <<< "$monitor"
    return
  fi

  active_workspace
}

client_workspace() {
  local address="$1"

  clients_json \
    | jq -r --arg address "$address" 'first(.[] | select(.address == $address) | .workspace.name) // empty'
}

client_pinned() {
  local address="$1"

  clients_json \
    | jq -r --arg address "$address" 'first(.[] | select(.address == $address) | .pinned) // false'
}

client_floating() {
  local address="$1"

  clients_json \
    | jq -r --arg address "$address" 'first(.[] | select(.address == $address) | .floating) // false'
}

set_floating() {
  local address="$1"
  local expected="$2"
  local current

  current="$(client_floating "$address")"
  if [[ "$current" != "$expected" ]]; then
    float_window "$address"
  fi
}

set_pinned() {
  local address="$1"
  local expected="$2"
  local current

  current="$(client_pinned "$address")"
  if [[ "$current" != "$expected" ]]; then
    pin_window "$address"
  fi
}

apply_saved_size() {
  local address="$1"

  [[ -z "$width" || -z "$height" ]] && return

  hypr_dispatch_lua "hl.dsp.window.resize({ x = ${width}, y = ${height}, window = $(lua_quote "address:${address}") })" || true
  invalidate_clients_json
}

position_bottom_right() {
  local address="$1"
  local monitor="${2:-}"
  local x y width height transform win_width win_height target_x target_y

  [[ -z "$monitor" ]] && monitor="$(current_monitor)"
  [[ -z "$monitor" ]] && return

  IFS=$'\t' read -r x y width height transform < <(jq -r '[.x, .y, .width, .height, .transform] | @tsv' <<< "$monitor")
  IFS=$'\t' read -r win_width win_height < <(
    clients_json \
      | jq -r --arg address "$address" 'first(.[] | select(.address == $address) | .size | @tsv) // empty'
  )

  [[ -z "$win_width" || -z "$win_height" ]] && return

  if [[ "$transform" == "1" || "$transform" == "3" ]]; then
    local rotated_width="$height"
    height="$width"
    width="$rotated_width"
  fi

  target_x=$((x + width - win_width - 7))
  target_y=$((y + height - win_height - 56))

  hypr_dispatch_lua "hl.dsp.window.move({ x = ${target_x}, y = ${target_y}, window = $(lua_quote "address:${address}") })" || true
  invalidate_clients_json
}

launch_app() {
	if ! declare -p fallback_command >/dev/null 2>&1; then
		"${command[@]}" >/dev/null 2>&1 &
		return
	fi

  if "${command[@]}" >/dev/null 2>&1; then
    return
  fi

  "${fallback_command[@]}" >/dev/null 2>&1 &
}

wait_for_address() {
  local address

  for _ in {1..50}; do
    invalidate_clients_json
    address="$(client_address)"
    if [[ -n "$address" ]]; then
      printf '%s\n' "$address"
      return 0
    fi

    sleep 0.1
  done

  return 1
}

address="$(client_address)"
if [[ -n "$address" ]]; then
  if [[ "$mode" == "prewarm" ]]; then
    set_pinned "$address" false
    move_window_to_workspace "$address" "$workspace"
  else
    current_workspace="$(client_workspace "$address")"
    if [[ "$current_workspace" == "$workspace" ]]; then
      park_other_visible_apps "$app_id"
      monitor="$(current_monitor)"
      target_workspace="$(target_workspace "$monitor")"
      [[ -z "$target_workspace" || "$target_workspace" == special:* ]] && target_workspace="+0"
      set_floating "$address" true
      apply_saved_size "$address"
      position_bottom_right "$address" "$monitor"
      move_window_to_workspace "$address" "$target_workspace"
      set_pinned "$address" true
    else
      set_pinned "$address" false
      move_window_to_workspace "$address" "$workspace"
    fi
  fi
  exit 0
fi

launch_app
address="$(wait_for_address || true)"

if [[ -z "$address" ]]; then
  exit 0
fi

if [[ "$mode" == "prewarm" ]]; then
  set_pinned "$address" false
  move_window_to_workspace "$address" "$workspace"
else
  park_other_visible_apps "$app_id"
  monitor="$(current_monitor)"
  target_workspace="$(target_workspace "$monitor")"
  [[ -z "$target_workspace" || "$target_workspace" == special:* ]] && target_workspace="+0"
  set_floating "$address" true
  apply_saved_size "$address"
  position_bottom_right "$address" "$monitor"
  move_window_to_workspace "$address" "$target_workspace"
  set_pinned "$address" true
fi

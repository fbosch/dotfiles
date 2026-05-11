#!/usr/bin/env bash

set -euo pipefail

app_id="${1:-}"
mode="${2:-open}"
taskbar_apps_file="${TASKBAR_APPS_FILE:-${HOME}/.config/hypr/taskbar/apps.json}"

if [[ "$app_id" == "--any-open" ]]; then
  hyprctl clients -j 2>/dev/null \
    | jq -e --slurpfile apps "$taskbar_apps_file" '
      def app_matches($window; $app):
        if $app.tag then (($window.tags // []) | index($app.tag + "*")) != null else $app.class == $window.class end;
      any(.[]; . as $window |
        any($apps[0][]; app_matches($window; .) and $window.pinned == true and $window.workspace.name != .workspace)
      )
    ' >/dev/null

  exit $?
fi

kill_all() {
  hyprctl clients -j 2>/dev/null \
    | jq -r --slurpfile apps "$taskbar_apps_file" '
      def app_matches($window; $app):
        if $app.tag then (($window.tags // []) | index($app.tag + "*")) != null else $app.class == $window.class end;
      .[] as $window |
      $apps[0][] |
      select(app_matches($window; .) and $window.workspace.name == .workspace) |
      $window.address
    ' \
    | sort -u \
    | while IFS= read -r address; do
      [[ -z "$address" ]] && continue
      hyprctl dispatch "hl.dsp.window.close($(lua_quote "address:${address}"))" >/dev/null 2>&1 || true
    done
}

park_other_visible_apps() {
  local current_id="$1"

  hyprctl clients -j 2>/dev/null \
    | jq -r --slurpfile apps "$taskbar_apps_file" --arg current_id "$current_id" '
      def app_matches($window; $app):
        if $app.tag then (($window.tags // []) | index($app.tag + "*")) != null else $app.class == $window.class end;
      .[] as $window |
      $apps[0][] |
      select(.id != $current_id) |
      select(app_matches($window; .) and $window.pinned == true and $window.workspace.name != .workspace) |
      "\($window.address)|\(.workspace)"
    ' \
    | while IFS='|' read -r address target_workspace; do
      [[ -z "$address" || -z "$target_workspace" ]] && continue
      hyprctl dispatch "hl.dsp.window.pin({ window = $(lua_quote "address:${address}") })" >/dev/null 2>&1 || true
      hyprctl dispatch "hl.dsp.window.move({ workspace = $(lua_quote "$target_workspace"), window = $(lua_quote "address:${address}"), follow = false })" >/dev/null 2>&1 || true
    done
}

park_active() {
  local active address workspace pinned

  active="$(hyprctl activewindow -j 2>/dev/null || printf '{}')"
  address="$(jq -r '.address // empty' <<< "$active")"
  workspace="$(jq -r --argjson active "$active" '
    def app_matches($window; $app):
      if $app.tag then (($window.tags // []) | index($app.tag + "*")) != null else $app.class == $window.class end;
    first(.[] | select(app_matches($active; .)) | .workspace) // empty
  ' "$taskbar_apps_file")"

  [[ -z "$address" || -z "$workspace" ]] && return 1

  pinned="$(jq -r '.pinned // false' <<< "$active")"
  if [[ "$pinned" == "true" ]]; then
    hyprctl dispatch "hl.dsp.window.pin({ window = $(lua_quote "address:${address}") })" >/dev/null 2>&1 || true
  fi

  hyprctl dispatch "hl.dsp.window.move({ workspace = $(lua_quote "$workspace"), window = $(lua_quote "address:${address}"), follow = false })" >/dev/null 2>&1 || true
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
  width="$(jq -r '.saved_size[0] // empty' <<< "$app_json")"
  height="$(jq -r '.saved_size[1] // empty' <<< "$app_json")"
  mapfile -t command < <(jq -r --arg home "$HOME" '.command[] | gsub("__HOME__"; $home)' <<< "$app_json")

  unset fallback_command
  if jq -e '.fallback_command' <<< "$app_json" >/dev/null; then
    mapfile -t fallback_command < <(jq -r --arg home "$HOME" '.fallback_command[] | gsub("__HOME__"; $home)' <<< "$app_json")
  fi
}

app_json="$(jq -c --arg id "$app_id" 'first(.[] | select(.id == $id)) // empty' "$taskbar_apps_file")"
[[ -z "$app_json" ]] && exit 1
load_app "$app_json"

lua_quote() {
  local value="$1"

  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '"%s"' "$value"
}

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
  if [[ -n "${tag:-}" ]]; then
    hyprctl clients -j 2>/dev/null \
      | jq -r --arg tag "${tag}*" 'first(.[] | select((.tags // []) | index($tag)) | .address) // empty'
  else
    hyprctl clients -j 2>/dev/null \
      | jq -r --arg class_name "$class_name" 'first(.[] | select(.class == $class_name) | .address) // empty'
  fi
}

move_window_to_workspace() {
  local address="$1"
  local target_workspace="$2"

  hyprctl dispatch "hl.dsp.window.move({ workspace = $(lua_quote "$target_workspace"), window = $(lua_quote "address:${address}"), follow = false })" >/dev/null 2>&1 || true
}

pin_window() {
  local address="$1"

  hyprctl dispatch "hl.dsp.window.pin({ window = $(lua_quote "address:${address}") })" >/dev/null 2>&1 || true
}

active_workspace() {
  hyprctl activeworkspace -j 2>/dev/null | jq -r '.name // empty'
}

current_monitor() {
  local cursor_x cursor_y monitors

  IFS=',' read -r cursor_x cursor_y <<< "$(hyprctl cursorpos 2>/dev/null || true)"
  cursor_x="${cursor_x## }"
  cursor_y="${cursor_y## }"
  monitors="$(hyprctl monitors -j 2>/dev/null)"

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
  active_monitor_name="$(hyprctl activeworkspace -j 2>/dev/null | jq -r '.monitor // empty')"
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

  hyprctl clients -j 2>/dev/null \
    | jq -r --arg address "$address" 'first(.[] | select(.address == $address) | .workspace.name) // empty'
}

client_pinned() {
  local address="$1"

  hyprctl clients -j 2>/dev/null \
    | jq -r --arg address "$address" 'first(.[] | select(.address == $address) | .pinned) // false'
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

  hyprctl dispatch "hl.dsp.window.resize({ x = ${width}, y = ${height}, window = $(lua_quote "address:${address}") })" >/dev/null 2>&1 || true
}

position_bottom_right() {
  local address="$1"
  local monitor="${2:-}"
  local x y width height transform win_width win_height target_x target_y

  [[ -z "$monitor" ]] && monitor="$(current_monitor)"
  [[ -z "$monitor" ]] && return

  IFS=$'\t' read -r x y width height transform < <(jq -r '[.x, .y, .width, .height, .transform] | @tsv' <<< "$monitor")
  IFS=$'\t' read -r win_width win_height < <(
    hyprctl clients -j 2>/dev/null \
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

  hyprctl dispatch "hl.dsp.window.move({ x = ${target_x}, y = ${target_y}, window = $(lua_quote "address:${address}") })" >/dev/null 2>&1 || true
}

launch_app() {
  if ! declare -p fallback_command >/dev/null 2>&1; then
    if [[ -n "${tag:-}" ]]; then
      hyprctl dispatch "hl.dsp.exec_cmd($(lua_quote "$(command_line "${command[@]}")"), { tag = $(lua_quote "+${tag}"), float = true, no_anim = true, no_initial_focus = true, workspace = $(lua_quote "${workspace} silent") })" >/dev/null 2>&1
    else
      "${command[@]}" >/dev/null 2>&1 &
    fi
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
  apply_saved_size "$address"
  position_bottom_right "$address" "$monitor"
  move_window_to_workspace "$address" "$target_workspace"
  set_pinned "$address" true
fi

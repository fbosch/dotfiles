#!/usr/bin/env bash

set -euo pipefail

app_id="${1:-}"
mode="${2:-open}"

readonly TASKBAR_APPS_JSON='[
    {
      "id": "calendar",
      "class_name": "org.gnome.Calendar",
      "tag": "taskbar_calendar*",
      "workspace": "special:taskbar-calendar",
      "command": ["gnome-calendar"]
    },
    {
      "id": "missioncenter",
      "class_name": "io.missioncenter.MissionCenter",
      "tag": "taskbar_missioncenter*",
      "workspace": "special:taskbar-missioncenter",
      "command": ["missioncenter"],
      "size": [754, 759]
    },
    {
      "id": "btop-cpu",
      "class_name": "btop_cpu_terminal",
      "workspace": "special:taskbar-btop-cpu",
      "command": ["footclient", "-N", "-a", "btop_cpu_terminal", "btop", "--config", "__HOME__/.config/btop/btop-cpu.conf", "--preset", "1"],
      "fallback_command": ["foot", "-a", "btop_cpu_terminal", "btop", "--config", "__HOME__/.config/btop/btop-cpu.conf", "--preset", "1"],
      "size": [920, 620]
    },
    {
      "id": "btop-mem",
      "class_name": "btop_mem_terminal",
      "workspace": "special:taskbar-btop-mem",
      "command": ["footclient", "-N", "-a", "btop_mem_terminal", "btop", "--config", "__HOME__/.config/btop/btop-mem.conf", "--preset", "2"],
      "fallback_command": ["foot", "-a", "btop_mem_terminal", "btop", "--config", "__HOME__/.config/btop/btop-mem.conf", "--preset", "2"],
      "size": [920, 620]
    },
    {
      "id": "nvitop",
      "class_name": "nvitop_terminal",
      "workspace": "special:taskbar-nvitop",
      "command": ["footclient", "-N", "-a", "nvitop_terminal", "nvitop"],
      "fallback_command": ["foot", "-a", "nvitop_terminal", "nvitop"],
      "size": [900, 655]
    },
    {
      "id": "s-tui",
      "class_name": "s_tui_terminal",
      "workspace": "special:taskbar-s-tui",
      "command": ["footclient", "-N", "-a", "s_tui_terminal", "s-tui"],
      "fallback_command": ["foot", "-a", "s_tui_terminal", "s-tui"],
      "size": [1200, 760]
    },
    {
      "id": "wiremix",
      "class_name": "wiremix_terminal",
      "workspace": "special:taskbar-wiremix",
      "command": ["footclient", "-N", "-a", "wiremix_terminal", "wiremix"],
      "fallback_command": ["foot", "-a", "wiremix_terminal", "wiremix"],
      "size": [725, 500]
    }
  ]'

any_open() {
  hyprctl clients -j 2>/dev/null \
    | jq -e --argjson apps "$TASKBAR_APPS_JSON" '
      def app_matches($window; $app):
        if $app.tag then (($window.tags // []) | index($app.tag)) != null else $app.class_name == $window.class end;
      any(.[]; . as $window |
        any($apps[]; app_matches($window; .) and $window.pinned == true and $window.workspace.name != .workspace)
      )
    ' >/dev/null
}

kill_all() {
  hyprctl clients -j 2>/dev/null \
    | jq -r --argjson apps "$TASKBAR_APPS_JSON" '
      def app_matches($window; $app):
        if $app.tag then (($window.tags // []) | index($app.tag)) != null else $app.class_name == $window.class end;
      .[] as $window |
      $apps[] |
      select(app_matches($window; .) and $window.workspace.name == .workspace) |
      $window.address
    ' \
    | sort -u \
    | while IFS= read -r address; do
      [[ -z "$address" ]] && continue
      hyprctl dispatch "hl.dsp.window.close($(jq -Rn --arg value "address:${address}" '$value'))" >/dev/null 2>&1 || true
    done
}

park_other_visible_apps() {
  local current_id="$1"

  hyprctl clients -j 2>/dev/null \
    | jq -r --argjson apps "$TASKBAR_APPS_JSON" --arg current_id "$current_id" '
      def app_matches($window; $app):
        if $app.tag then (($window.tags // []) | index($app.tag)) != null else $app.class_name == $window.class end;
      .[] as $window |
      $apps[] |
      select(.id != $current_id) |
      select(app_matches($window; .) and $window.pinned == true and $window.workspace.name != .workspace) |
      "\($window.address)|\(.workspace)"
    ' \
    | while IFS='|' read -r address target_workspace; do
      [[ -z "$address" || -z "$target_workspace" ]] && continue
      hyprctl dispatch "hl.dsp.window.pin({ window = $(jq -Rn --arg value "address:${address}" '$value') })" >/dev/null 2>&1 || true
      hyprctl dispatch "hl.dsp.window.move({ workspace = $(jq -Rn --arg value "$target_workspace" '$value'), window = $(jq -Rn --arg value "address:${address}" '$value'), follow = false })" >/dev/null 2>&1 || true
    done
}

park_active() {
  local active address workspace pinned

  active="$(hyprctl activewindow -j 2>/dev/null || printf '{}')"
  address="$(jq -r '.address // empty' <<< "$active")"
  workspace="$(jq -r --argjson active "$active" '
    def app_matches($window; $app):
      if $app.tag then (($window.tags // []) | index($app.tag)) != null else $app.class_name == $window.class end;
    first(.[] | select(app_matches($active; .)) | .workspace) // empty
  ' <<< "$TASKBAR_APPS_JSON")"

  [[ -z "$address" || -z "$workspace" ]] && return 1

  pinned="$(jq -r '.pinned // false' <<< "$active")"
  if [[ "$pinned" == "true" ]]; then
    hyprctl dispatch "hl.dsp.window.pin({ window = $(jq -Rn --arg value "address:${address}" '$value') })" >/dev/null 2>&1 || true
  fi

  hyprctl dispatch "hl.dsp.window.move({ workspace = $(jq -Rn --arg value "$workspace" '$value'), window = $(jq -Rn --arg value "address:${address}" '$value'), follow = false })" >/dev/null 2>&1 || true
}

if [[ "$app_id" == "--any-open" ]]; then
  any_open
  exit $?
fi

if [[ "$app_id" == "--park-active" ]]; then
  park_active
  exit $?
fi

if [[ "$app_id" == "--kill-all" ]]; then
  kill_all
  exit 0
fi

case "$app_id" in
  calendar)
    class_name="org.gnome.Calendar"
    tag="taskbar_calendar"
    workspace="special:taskbar-calendar"
    width=""
    height=""
    command=(gnome-calendar)
    ;;
  missioncenter)
    class_name="io.missioncenter.MissionCenter"
    tag="taskbar_missioncenter"
    workspace="special:taskbar-missioncenter"
    width="754"
    height="759"
    command=(missioncenter)
    ;;
  btop-cpu)
    class_name="btop_cpu_terminal"
    workspace="special:taskbar-btop-cpu"
    width="920"
    height="620"
    command=(footclient -N -a btop_cpu_terminal btop --config "$HOME/.config/btop/btop-cpu.conf" --preset 1)
    fallback_command=(foot -a btop_cpu_terminal btop --config "$HOME/.config/btop/btop-cpu.conf" --preset 1)
    ;;
  btop-mem)
    class_name="btop_mem_terminal"
    workspace="special:taskbar-btop-mem"
    width="920"
    height="620"
    command=(footclient -N -a btop_mem_terminal btop --config "$HOME/.config/btop/btop-mem.conf" --preset 2)
    fallback_command=(foot -a btop_mem_terminal btop --config "$HOME/.config/btop/btop-mem.conf" --preset 2)
    ;;
  nvitop)
    class_name="nvitop_terminal"
    workspace="special:taskbar-nvitop"
    width="900"
    height="655"
    command=(footclient -N -a nvitop_terminal nvitop)
    fallback_command=(foot -a nvitop_terminal nvitop)
    ;;
  s-tui)
    class_name="s_tui_terminal"
    workspace="special:taskbar-s-tui"
    width="1200"
    height="760"
    command=(footclient -N -a s_tui_terminal s-tui)
    fallback_command=(foot -a s_tui_terminal s-tui)
    ;;
  wiremix)
    class_name="wiremix_terminal"
    workspace="special:taskbar-wiremix"
    width="725"
    height="500"
    command=(footclient -N -a wiremix_terminal wiremix)
    fallback_command=(foot -a wiremix_terminal wiremix)
    ;;
  *)
    exit 1
    ;;
esac

lua_quote() {
  jq -Rn --arg value "$1" '$value'
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

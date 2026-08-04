#!/usr/bin/env dash

__hypr_ipc_socket_ready=""
__hypr_ipc_socket_path=""

hypr_instance_runtime_dir() {
  if [ -z "${XDG_RUNTIME_DIR:-}" ] || [ -z "${HYPRLAND_INSTANCE_SIGNATURE:-}" ]; then
    return 1
  fi

  printf '%s/hypr/%s\n' "$XDG_RUNTIME_DIR" "$HYPRLAND_INSTANCE_SIGNATURE"
}

hypr_instance_path() {
  runtime_dir="$(hypr_instance_runtime_dir)" || return 1
  printf '%s/%s\n' "$runtime_dir" "$1"
}

hypr_instance_socket_path() {
  socket_path="$(hypr_instance_path "$1")" || return 1
  [ "${#socket_path}" -le 107 ] || return 1
  printf '%s\n' "$socket_path"
}

hypr_query_socket_path() {
  hypr_instance_socket_path '.socket.sock'
}

hypr_query_socket_available() {
  if [ -n "$__hypr_ipc_socket_ready" ]; then
    [ "$__hypr_ipc_socket_ready" = "1" ]
    return
  fi

  __hypr_ipc_socket_path="$(hypr_query_socket_path 2>/dev/null || true)"
  if [ -n "$__hypr_ipc_socket_path" ] && [ -S "$__hypr_ipc_socket_path" ] && command -v nc >/dev/null 2>&1; then
    __hypr_ipc_socket_ready="1"
  else
    __hypr_ipc_socket_ready="0"
  fi

  [ "$__hypr_ipc_socket_ready" = "1" ]
}

hypr_query() {
  request="$1"

  if hypr_query_socket_available; then
    printf '%s' "$request" | nc -U "$__hypr_ipc_socket_path" 2>/dev/null
    return
  fi

  case "$request" in
    j/activewindow) hyprctl activewindow -j 2>/dev/null ;;
    j/activeworkspace) hyprctl activeworkspace -j 2>/dev/null ;;
    j/clients) hyprctl clients -j 2>/dev/null ;;
    j/cursorpos) hyprctl cursorpos -j 2>/dev/null ;;
    j/monitors) hyprctl monitors -j 2>/dev/null ;;
    activewindow) hyprctl activewindow 2>/dev/null ;;
    monitors) hyprctl monitors 2>/dev/null ;;
    cursorpos) hyprctl cursorpos 2>/dev/null ;;
    *) return 1 ;;
  esac
}

hypr_dispatch_lua() {
  dispatcher="$1"

  if hypr_query_socket_available; then
    printf 'dispatch %s' "$dispatcher" | nc -U "$__hypr_ipc_socket_path" >/dev/null 2>&1
    return
  fi

  hyprctl dispatch "$dispatcher" >/dev/null
}

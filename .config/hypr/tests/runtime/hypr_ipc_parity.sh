#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
hypr_ipc_sh="$repo_root/runtime/lib/hypr-ipc.sh"

# shellcheck disable=SC1090
. "$hypr_ipc_sh"

assert_equal() {
  local actual="$1" expected="$2" label="$3"

  if [ "$actual" != "$expected" ]; then
    printf 'mismatch %s: shell=%s lua=%s\n' "$label" "$expected" "$actual" >&2
    exit 1
  fi
}

lua_runtime_dir() {
  XDG_RUNTIME_DIR="$1" HYPRLAND_INSTANCE_SIGNATURE="$2" luajit -e '
    local home = os.getenv("HOME")
    package.path = home .. "/.config/hypr/?.lua;" .. home .. "/.config/hypr/?/init.lua;" .. package.path
    print(require("runtime.lib.hypr-ipc").instance_runtime_dir())
  '
}

lua_socket_path() {
  XDG_RUNTIME_DIR="$1" HYPRLAND_INSTANCE_SIGNATURE="$2" PARITY_NAME="$3" luajit -e '
    local home = os.getenv("HOME")
    package.path = home .. "/.config/hypr/?.lua;" .. home .. "/.config/hypr/?/init.lua;" .. package.path
    local hypr_ipc = require("runtime.lib.hypr-ipc")
    local ok, path = pcall(hypr_ipc.instance_socket_path, os.getenv("PARITY_NAME"))
    print(ok and path or "ERR")
  '
}

shell_runtime_dir() {
  XDG_RUNTIME_DIR="$1" HYPRLAND_INSTANCE_SIGNATURE="$2" hypr_instance_runtime_dir
}

shell_socket_path() {
  local out
  out="$(XDG_RUNTIME_DIR="$1" HYPRLAND_INSTANCE_SIGNATURE="$2" hypr_instance_socket_path "$3" 2>/dev/null)" || {
    printf 'ERR\n'
    return
  }
  printf '%s\n' "$out"
}

runtime="/run/user/1000"
sig="instance-a"

assert_equal "$(lua_runtime_dir "$runtime" "$sig")" "$(shell_runtime_dir "$runtime" "$sig")" "runtime dir"

for name in ".socket.sock" ".socket2.sock" "waybar-monitor.sock" "daemon/command.sock"; do
  assert_equal "$(lua_socket_path "$runtime" "$sig" "$name")" "$(shell_socket_path "$runtime" "$sig" "$name")" "socket path $name"
done

long_name="$(printf 'x%.0s' {1..108})"
assert_equal "$(lua_socket_path "$runtime" "$sig" "$long_name")" "$(shell_socket_path "$runtime" "$sig" "$long_name")" "reject long socket path"
assert_equal "$(shell_socket_path "$runtime" "$sig" "$long_name")" "ERR" "shell rejects long path"

printf 'PASS hypr-ipc path grammar matches across Lua and shell\n'

#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../../.." && pwd)"
test_dir="$(mktemp -d)"
original_path="$PATH"
luajit_path="$(command -v luajit)"

cleanup() {
  for pid in ${watchdog_pid:-} ${query_pid:-} ${event_pid:-}; do
    kill -TERM "$pid" >/dev/null 2>&1 || true
    wait "$pid" >/dev/null 2>&1 || true
  done
  rm -rf "$test_dir"
}
trap cleanup EXIT

assert_contains() {
  local file="$1" expected="$2"
  grep -Fq -- "$expected" "$file" || {
    printf 'missing log entry: %s\n' "$expected" >&2
    printf '%s\n' "$(<"$file")" >&2
    exit 1
  }
}

assert_not_contains() {
  local file="$1" unexpected="$2"
  if grep -Fq -- "$unexpected" "$file"; then
    printf 'unexpected log entry: %s\n' "$unexpected" >&2
    printf '%s\n' "$(<"$file")" >&2
    exit 1
  fi
}

wait_for_file() {
  local file="$1" description="$2" attempts=0
  while [[ ! -s "$file" ]]; do
    attempts=$((attempts + 1))
    if ((attempts >= 80)); then
      printf 'timed out waiting for %s\n' "$description" >&2
      [[ -f "${file%/*}/err" ]] && { printf '%s\n' '--- daemon stderr ---' >&2; printf '%s\n' "$(<"${file%/*}/err")" >&2; }
      exit 1
    fi
    sleep 0.05
  done
}

wait_for_socket() {
  local socket="$1" description="$2" attempts=0
  while [[ ! -S "$socket" ]]; do
    attempts=$((attempts + 1))
    ((attempts < 80)) || { printf 'timed out waiting for %s\n' "$description" >&2; exit 1; }
    sleep 0.05
  done
}

cat > "$test_dir/fake_socket.lua" <<'EOF'
#!/usr/bin/env luajit
local ffi = require("ffi")
ffi.cdef[[
  typedef unsigned short sa_family_t;
  struct sockaddr_un { sa_family_t sun_family; char sun_path[108]; };
  int socket(int, int, int); int bind(int, const void *, unsigned int);
  int listen(int, int); int accept(int, void *, unsigned int *);
  int recv(int, void *, unsigned long, int); int send(int, const void *, unsigned long, int);
  int close(int); int unlink(const char *); int usleep(unsigned int);
]]
local AF_UNIX, SOCK_STREAM = 1, 1
local path, kind = assert(arg[1]), assert(arg[2])
local clear_file, ready_file = assert(arg[3]), assert(arg[4])
local function make_server()
  ffi.C.unlink(path)
  local fd = assert(ffi.C.socket(AF_UNIX, SOCK_STREAM, 0))
  local address = ffi.new("struct sockaddr_un")
  address.sun_family = AF_UNIX
  ffi.copy(address.sun_path, path, #path)
  assert(ffi.C.bind(fd, address, 2 + #path) == 0)
  assert(ffi.C.listen(fd, 4) == 0)
  return fd
end
local function accept(fd)
  local length = ffi.new("unsigned int[1]", ffi.sizeof("struct sockaddr_un"))
  return assert(ffi.C.accept(fd, nil, length))
end
local function close(fd) ffi.C.close(fd) end
local server = make_server()
local ready = io.open(ready_file, "w"); ready:close()
if kind == "query" then
  while true do
    local client = accept(server)
    local buffer = ffi.new("char[64]")
    ffi.C.recv(client, buffer, 64, 0)
    local clients = io.open(clear_file, "r") and "[]" or
      '[{"pid":4242,"class":"fixture-game","initialClass":"fixture-game","title":"Fixture","initialTitle":"Fixture","contentType":"game","workspace":{"name":"10"},"focusHistoryID":0}]'
    local monitors = '[{"name":"fixture","focused":true,"activeWorkspace":{"name":"1"},"specialWorkspace":{"name":""}}]'
    local response = buffer == nil and "" or (clients .. "\n")
    if ffi.string(buffer):match("j/monitors") then response = monitors .. "\n" end
    ffi.C.send(client, response, #response, 0)
    close(client)
  end
end
if kind == "stable" then
  local client = accept(server)
  while true do ffi.C.usleep(20000) end
end
local connection = 0
while true do
  connection = connection + 1
  local client = accept(server)
  if connection == 1 then
    close(client)
  else
    while not io.open(clear_file, "r") do ffi.C.usleep(20000) end
    local event = "workspace>>10\n"
    ffi.C.send(client, event, #event, 0)
    while true do ffi.C.usleep(20000) end
  end
end
EOF
chmod +x "$test_dir/fake_socket.lua"

run_case() {
  local name="$1" freeze_mode="$2" clients_mode="$3" event_mode="${4:-event}"
  local case_dir="$test_dir/$name"
  local bin_dir="$case_dir/bin" home_dir="$case_dir/home"
  local runtime_dir="$case_dir/runtime"
  local socket_dir="$runtime_dir/hypr/fixture"
  mkdir -p "$bin_dir" "$home_dir/.config" "$socket_dir"
  cp -a "$repo_root/.config/hypr" "$home_dir/.config/"
  # shellcheck disable=SC2016
  printf '%s\n' '#!/bin/sh' 'printf "%s %s\n" "$*" >> "$PROFILE_LOG"' 'exit 0' > "$home_dir/.config/hypr/runtime/profiles/profilectl.sh"
  chmod +x "$home_dir/.config/hypr/runtime/profiles/profilectl.sh"
  # shellcheck disable=SC2016
  printf '%s\n' '#!/bin/sh' 'if [ "$FREEZE_MODE" = missing ]; then exit 127; fi' 'printf "%s\n" "$*" >> "$FREEZE_LOG"' 'if [ "$FREEZE_MODE" = failed ]; then exit 1; fi' 'if [ -e "$FREEZE_STATE" ]; then rm -f "$FREEZE_STATE"; else : > "$FREEZE_STATE"; fi' > "$bin_dir/wl-freeze"
  # shellcheck disable=SC2016
  printf '%s\n' '#!/bin/sh' 'if [ -e "$FREEZE_STATE" ]; then printf "T\n"; else printf "R\n"; fi' > "$bin_dir/ps"
  chmod +x "$bin_dir/wl-freeze" "$bin_dir/ps"
  if [[ "$freeze_mode" == missing ]]; then rm "$bin_dir/wl-freeze"; fi
  for utility in bash dirname flock luajit mkdir rm sleep touch; do ln -s "$(command -v "$utility")" "$bin_dir/$utility"; done
  touch "$case_dir/ready-query" "$case_dir/ready-event"
  rm "$case_dir/ready-query" "$case_dir/ready-event"
  "$luajit_path" "$test_dir/fake_socket.lua" "$socket_dir/.socket.sock" query "$case_dir/clear" "$case_dir/ready-query" & query_pid=$!
  "$luajit_path" "$test_dir/fake_socket.lua" "$socket_dir/.socket2.sock" "$event_mode" "$case_dir/clear" "$case_dir/ready-event" & event_pid=$!
  wait_for_socket "$socket_dir/.socket.sock" "$name query socket"
  wait_for_socket "$socket_dir/.socket2.sock" "$name event socket"
  export HOME="$home_dir" PATH="$bin_dir" XDG_RUNTIME_DIR="$runtime_dir" HYPRLAND_INSTANCE_SIGNATURE=fixture
  export PROFILE_LOG="$case_dir/profile.log" FREEZE_LOG="$case_dir/freeze.log" FREEZE_STATE="$case_dir/frozen" FREEZE_MODE="$freeze_mode"
  : > "$PROFILE_LOG"; : > "$FREEZE_LOG"
  if [[ "$clients_mode" == empty ]]; then touch "$case_dir/clear"; fi
  "$home_dir/.config/hypr/runtime/gaming/daemons/gaming-session-watchdog/gaming-session-watchdog.sh" > "$case_dir/out" 2> "$case_dir/err" & watchdog_pid=$!
  wait_for_file "$PROFILE_LOG" "$name profile sync"
  sleep 1.2
  if [[ "$clients_mode" == game && "$freeze_mode" == success ]]; then
    touch "$case_dir/clear"
    sleep 1.2
    export PATH="$original_path"
    assert_contains "$FREEZE_LOG" '-p 4242 -s'
    [[ ! -e "$FREEZE_STATE" ]] || { printf 'owned process was not unfrozen\n' >&2; exit 1; }
  fi
  kill -TERM "$watchdog_pid"
  wait "$watchdog_pid" || true
  watchdog_pid=""
  export PATH="$original_path"
  if [[ "$clients_mode" == game && "$freeze_mode" == missing ]]; then
    assert_contains "$case_dir/err" 'gaming-session-watchdog: wl-freeze is unavailable; process freezing is disabled'
    assert_contains "$case_dir/err" 'gaming-session-watchdog: event socket closed; retrying in 1s'
    assert_contains "$case_dir/err" 'gaming-session-watchdog: event socket reconnected'
  elif [[ "$clients_mode" == game && "$freeze_mode" == failed ]]; then
    assert_contains "$case_dir/err" 'gaming-session-watchdog: failed to freeze PID 4242'
  else
    assert_not_contains "$case_dir/err" 'wl-freeze is unavailable'
    assert_not_contains "$case_dir/err" 'failed to '
  fi
  kill -TERM "$query_pid" "$event_pid" >/dev/null 2>&1 || true
  wait "$query_pid" "$event_pid" >/dev/null 2>&1 || true
  query_pid=""; event_pid=""
}

run_case missing missing game event
run_case failed failed game event
run_case ordinary missing empty stable
run_case cleanup success game event
assert_contains "$test_dir/cleanup/profile.log" 'sync gaming 0'
assert_contains "$test_dir/cleanup/err" 'event socket closed; retrying in 1s'
assert_contains "$test_dir/cleanup/err" 'event socket reconnected'

printf 'PASS gaming-session-watchdog bounded runtime fixture\n'

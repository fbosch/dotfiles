#!/usr/bin/env bash

set -euo pipefail

test_dir="$(mktemp -d)"
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
runtime_dir="$test_dir/runtime"
capture_dir="$test_dir/captures"
bin_dir="$test_dir/bin"
event_server="$test_dir/event-server.lua"
event_server_pid=""
wrapper_pid=""

cleanup() {
  if [[ -n "$wrapper_pid" ]]; then
    kill -TERM "$wrapper_pid" >/dev/null 2>&1 || true
    wait "$wrapper_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$event_server_pid" ]]; then
    kill -TERM "$event_server_pid" >/dev/null 2>&1 || true
    wait "$event_server_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "${live_worker_pid:-}" ]]; then
    kill -TERM "$live_worker_pid" >/dev/null 2>&1 || true
    wait "$live_worker_pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$test_dir"
}
trap cleanup EXIT

mkdir -p "$runtime_dir/hypr/fixture" "$capture_dir" "$bin_dir"

cat > "$event_server" <<'LUA'
local socket = require("socket")
local unix = require("socket.unix")

local path = assert(arg[1])
local server = assert(unix())
assert(server:bind(path))
assert(server:listen(1))
local client = assert(server:accept())
client:settimeout(0.2)
for index = 1, 400 do
  client:send("workspacev2>>fixture-" .. tostring(index) .. "\n")
  socket.sleep(0.002)
end
socket.sleep(0.5)
client:close()
server:close()
LUA

cat > "$bin_dir/hyprctl" <<'SH'
#!/usr/bin/env bash
case "$*" in
  *'activewindow -j') printf '{}\n' ;;
  *'clients -j') printf '%s\n' '[{"address":"0xfixture","mapped":true,"size":[100,100],"workspace":{"id":1}}]' ;;
  *'monitors -j') printf '%s\n' '[{"activeWorkspace":{"id":1}}]' ;;
  *) exit 1 ;;
esac
SH
cat > "$bin_dir/grim" <<'SH'
#!/usr/bin/env bash
output="${!#}"
printf 'fixture-image' > "$output"
sleep 3
SH
chmod +x "$bin_dir/hyprctl" "$bin_dir/grim"

start_event_server() {
  rm -f "$runtime_dir/hypr/fixture/.socket2.sock"
  luajit "$event_server" "$runtime_dir/hypr/fixture/.socket2.sock" &
  event_server_pid="$!"
  for _ in {1..100}; do
    [[ -S "$runtime_dir/hypr/fixture/.socket2.sock" ]] && return
    if ! kill -0 "$event_server_pid" >/dev/null 2>&1; then
      printf 'event server exited before binding\n' >&2
      exit 1
    fi
    sleep 0.01
  done
  printf 'event server did not bind\n' >&2
  exit 1
}

start_daemon() {
  XDG_RUNTIME_DIR="$runtime_dir" \
    HYPRLAND_INSTANCE_SIGNATURE=fixture \
    HYPR_WINDOW_CAPTURE_DIR="$capture_dir" \
    HYPR_WINDOW_CAPTURE_DAEMON="$repo_root/runtime/windows/daemons/window-capture/window-capture-daemon.lua" \
    PATH="$bin_dir:$PATH" \
    "$repo_root/runtime/windows/daemons/window-capture/window-capture-daemon.sh" >"$test_dir/daemon.log" 2>&1 &
  wrapper_pid="$!"
}

wait_for_owner_change() {
  local expected="$1"
  for _ in {1..100}; do
    if [[ -r "$runtime_dir/hypr-window-capture-worker.lock.d/owner" ]]; then
      owner_line="$(<"$runtime_dir/hypr-window-capture-worker.lock.d/owner")"
      read -r owner_pid owner_token <<< "$owner_line"
      if [[ "$owner_pid" != "$expected" && "$owner_token" == *-* 
        && "$owner_pid" =~ ^[0-9]+$ ]]; then
        return
      fi
    fi
    sleep 0.01
  done
  printf 'stale worker marker was not replaced:\n%s\n' "$(<"$test_dir/daemon.log")" >&2
  exit 1
}

stale_pid=99999999
mkdir "$runtime_dir/hypr-window-capture-worker.lock.d"
printf '%s\tstale-token\n' "$stale_pid" > "$runtime_dir/hypr-window-capture-worker.lock.d/owner"
printf 'fixture-stale\tworkspacev2>>fixture-stale\n' > "$capture_dir/.pending_event"
start_event_server
start_daemon
wait_for_owner_change "$stale_pid"
rm -f "$capture_dir/.pending_event"

pending_reader_failed="$test_dir/pending-reader-failed"
(
  for _ in {1..250}; do
    if [[ -r "$capture_dir/.pending_event" ]]; then
      pending="$(<"$capture_dir/.pending_event")"
      if [[ -n "$pending" ]]; then
        capture_id="${pending%%$'\t'*}"
        event_line="${pending#*$'\t'}"
        if [[ ! "$pending" == *$'\t'* || ! "$capture_id" =~ ^[0-9]+_workspace$ \
          || ! "$event_line" =~ ^workspacev2\>\>fixture-[0-9]+$ ]]; then
          : > "$pending_reader_failed"
          exit 1
        fi
      fi
    fi
    sleep 0.01
  done
) &
pending_reader_pid="$!"

wait "$pending_reader_pid" || true
if [[ -e "$pending_reader_failed" ]]; then
  printf 'pending event reader observed malformed content\n' >&2
  exit 1
fi

kill -TERM "$wrapper_pid"
wait "$wrapper_pid" || true
wrapper_pid=""
kill -TERM "$event_server_pid" >/dev/null 2>&1 || true
wait "$event_server_pid" >/dev/null 2>&1 || true
event_server_pid=""
for _ in {1..100}; do
  [[ ! -d "$runtime_dir/hypr-window-capture-daemon.lock.d" \
    && ! -d "$runtime_dir/hypr-window-capture-worker.lock.d" ]] && break
  sleep 0.01
done
test ! -d "$runtime_dir/hypr-window-capture-worker.lock.d"
if [[ -d "$runtime_dir/hypr-window-capture-daemon.lock.d" ]]; then
  read -r daemon_pid < "$runtime_dir/hypr-window-capture-daemon.lock.d/pid" || true
  if kill -0 "$daemon_pid" >/dev/null 2>&1; then
    printf 'daemon owner %s survived cleanup\n' "$daemon_pid" >&2
    exit 1
  fi
  rm -rf "$runtime_dir/hypr-window-capture-daemon.lock.d"
fi

live_worker_pid=""
setsid bash -c 'trap "exit 0" TERM INT; while true; do sleep 1; done' bash &
live_worker_pid="$!"
mkdir "$runtime_dir/hypr-window-capture-worker.lock.d"
printf '%s\tlive-token\n' "$live_worker_pid" > "$runtime_dir/hypr-window-capture-worker.lock.d/owner"
start_event_server
start_daemon
sleep 0.25
owner_line="$(<"$runtime_dir/hypr-window-capture-worker.lock.d/owner")"
read -r owner_pid owner_token <<< "$owner_line"
test "$owner_pid" = "$live_worker_pid"
test "$owner_token" = live-token

kill -TERM "$wrapper_pid"
wait "$wrapper_pid" || true
wrapper_pid=""
kill -TERM "$event_server_pid" >/dev/null 2>&1 || true
wait "$event_server_pid" >/dev/null 2>&1 || true
event_server_pid=""
kill -TERM "$live_worker_pid" >/dev/null 2>&1 || true
wait "$live_worker_pid" || true
live_worker_pid=""
rm -rf "$runtime_dir/hypr-window-capture-worker.lock.d"

printf 'PASS window-capture ownership and pending-event publication\n'

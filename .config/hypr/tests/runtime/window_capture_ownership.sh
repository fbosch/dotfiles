#!/usr/bin/env bash

set -euo pipefail

if [[ ! -r /proc/self/stat ]]; then
  printf 'SKIP window-capture ownership requires Linux /proc process identity\n'
  exit 0
fi

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
test_dir="$(mktemp -d)"
runtime_dir="$test_dir/runtime"
capture_dir="$test_dir/captures"
bin_dir="$test_dir/bin"
home_dir="$test_dir/home"
event_server="$test_dir/event-server.lua"
control="$repo_root/runtime/windows/daemons/window-capture/window-capturectl.sh"
original_path="$PATH"
wrapper_pid=""
event_server_pid=""
reader_pid=""
live_worker_pid=""

cleanup() {
  if [[ -n "$wrapper_pid" ]]; then
    kill -CONT "$wrapper_pid" >/dev/null 2>&1 || true
    kill -TERM "$wrapper_pid" >/dev/null 2>&1 || true
    wait "$wrapper_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$event_server_pid" ]]; then
    kill -TERM "$event_server_pid" >/dev/null 2>&1 || true
    wait "$event_server_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$reader_pid" ]]; then
    kill -TERM "$reader_pid" >/dev/null 2>&1 || true
    wait "$reader_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$live_worker_pid" ]]; then
    kill -TERM -- "-$live_worker_pid" >/dev/null 2>&1 || true
    wait "$live_worker_pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$test_dir"
}
trap cleanup EXIT

mkdir -p "$runtime_dir/hypr/fixture" "$capture_dir" "$bin_dir" "$home_dir/.config"
ln -s "$repo_root" "$home_dir/.config/hypr"

cat > "$event_server" <<'LUA'
local socket = require("socket")
local unix = require("socket.unix")

local socket_path, trigger, sent = arg[1], arg[2], arg[3]
local server = assert(unix())
assert(server:bind(socket_path))
assert(server:listen(1))
local client = assert(server:accept())

for _ = 1, 100 do
  local handle = io.open(trigger, "r")
  if handle then
    handle:close()
    break
  end
  socket.sleep(0.01)
end

for index = 1, 32 do
  assert(client:send("workspacev2>>fixture-" .. tostring(index) .. "\n"))
  socket.sleep(0.01)
end
local handle = assert(io.open(sent, "w"))
handle:write("sent\n")
handle:close()
socket.sleep(0.2)
client:close()
server:close()
LUA

cat > "$bin_dir/hyprctl" <<'SH'
#!/usr/bin/env bash
case "$*" in
  *'activewindow -j') printf '{}\n' ;;
  *'clients -j') printf '%s\n' '[{"address":"0xfixture","mapped":true,"size":[100,100],"workspace":{"id":1}},{"address":"0xoffscreen","stableId":"offscreen-id","mapped":true,"size":[100,100],"workspace":{"id":10}}]' ;;
  *'monitors -j') printf '%s\n' '[{"activeWorkspace":{"id":1}}]' ;;
  *) exit 1 ;;
esac
SH

cat > "$bin_dir/grim" <<'SH'
#!/usr/bin/env bash
output="${!#}"
sleep 0.4
printf 'fixture-image\n' > "$output"
SH
chmod +x "$bin_dir/hyprctl" "$bin_dir/grim"

HOME="$home_dir" \
  PATH="$bin_dir:$original_path" \
  XDG_RUNTIME_DIR="$runtime_dir" \
  HYPRLAND_INSTANCE_SIGNATURE=fixture \
  HYPR_WINDOW_CAPTURE_DIR="$capture_dir" \
  luajit "$repo_root/runtime/windows/daemons/window-capture/window-capture-daemon.lua" \
  handle-event 'openwindow>>0xoffscreen,10,fixture,Offscreen'
test -s "$capture_dir/offscreen-id.jpg"

wait_for_file() {
  local file="$1" description="$2"
  for _ in {1..200}; do
    [[ -r "$file" ]] && return 0
    sleep 0.01
  done
  printf 'timed out waiting for %s (%s)\n' "$description" "$file" >&2
  exit 1
}

wait_for_absent() {
  local path="$1" description="$2"
  for _ in {1..200}; do
    [[ ! -e "$path" ]] && return 0
    sleep 0.01
  done
  printf 'timed out waiting for %s (%s)\n' "$description" "$path" >&2
  exit 1
}

start_event_server() {
  local trigger="$1" sent="$2" socket_path="$runtime_dir/hypr/fixture/.socket2.sock"
  rm -f "$socket_path" "$trigger" "$sent"
  luajit "$event_server" "$socket_path" "$trigger" "$sent" &
  event_server_pid="$!"
  wait_for_file "$socket_path" "event socket"
}

start_daemon() {
  HOME="$home_dir" \
    PATH="$bin_dir:$original_path" \
    XDG_RUNTIME_DIR="$runtime_dir" \
    HYPRLAND_INSTANCE_SIGNATURE=fixture \
    HYPR_WINDOW_CAPTURE_DIR="$capture_dir" \
    "$repo_root/runtime/windows/daemons/window-capture/window-capture-daemon.sh" \
    >"$test_dir/daemon.log" 2>&1 &
  wrapper_pid="$!"
  wait_for_file "$runtime_dir/hypr-window-capture-daemon.lock.d/pid" "daemon lock"
}

capturectl() {
  HOME="$home_dir" \
    PATH="$bin_dir:$original_path" \
    XDG_RUNTIME_DIR="$runtime_dir" \
    HYPRLAND_INSTANCE_SIGNATURE=fixture \
    HYPR_WINDOW_CAPTURE_DIR="$capture_dir" \
    "$control" "$@"
}

process_state() {
  ps -o stat= -p "$1" | tr -d '[:space:]'
}

process_is_stopped() {
  [[ "$(process_state "$1")" == T* ]]
}

process_start_time() {
  local stat remainder fields

  stat="$(<"/proc/$1/stat")"
  remainder="${stat##*) }"
  read -r -a fields <<< "$remainder"
  printf '%s\n' "${fields[19]}"
}

stop_daemon() {
  kill -CONT "$wrapper_pid" >/dev/null 2>&1 || true
  kill -TERM "$wrapper_pid" >/dev/null 2>&1 || true
  for _ in {1..200}; do
    kill -0 "$wrapper_pid" >/dev/null 2>&1 || break
    sleep 0.01
  done
  if kill -0 "$wrapper_pid" >/dev/null 2>&1; then
    kill -KILL "$wrapper_pid"
  fi
  wait "$wrapper_pid" || true
  wrapper_pid=""
  wait_for_absent "$runtime_dir/hypr-window-capture-daemon.lock.d" "daemon lock cleanup"
}

reader_failed="$test_dir/reader-failed"
tab=$'\t'
(
  for _ in {1..600}; do
    if [[ -r "$capture_dir/.pending_event" ]]; then
      if pending="$(<"$capture_dir/.pending_event")" 2>/dev/null; then
        if [[ ! "$pending" =~ ^[0-9]+_(activewindow|workspace|windowupdate|windowtitle|windowsettle)${tab}workspacev2\>\>fixture-[0-9]+$ ]]; then
          : > "$reader_failed"
          exit 1
        fi
      fi
    fi
    sleep 0.01
  done
) &
reader_pid="$!"

# A delivered event must recover a worker marker whose recorded process is gone.
sleep 0.01 &
stale_pid="$!"
wait "$stale_pid"
mkdir "$runtime_dir/hypr-window-capture-worker.lock.d"
printf '%s\tstale-token\n' "$stale_pid" > "$runtime_dir/hypr-window-capture-worker.lock.d/owner"

stale_trigger="$test_dir/stale-trigger"
stale_sent="$test_dir/stale-sent"
stale_owner_seen="$test_dir/stale-owner-seen"
start_event_server "$stale_trigger" "$stale_sent"
start_daemon
daemon_pid="$(<"$runtime_dir/hypr-window-capture-daemon.lock.d/pid")"
wait_for_file "$runtime_dir/hypr-window-capture-daemon.lock.d/owner" "daemon owner record"
capture_status="$(capturectl status)"
[[ "$capture_status" == *'daemon=running'* ]]
capturectl pause
process_is_stopped "$daemon_pid"
capturectl pause
process_is_stopped "$daemon_pid"
capture_status="$(capturectl status)"
[[ "$capture_status" == *'daemon=paused'* ]]
capturectl resume
for _ in {1..100}; do
  process_is_stopped "$daemon_pid" || break
  sleep 0.01
done
if process_is_stopped "$daemon_pid"; then
  exit 1
fi
capturectl resume
if process_is_stopped "$daemon_pid"; then
  exit 1
fi
capturectl refresh

# A stale lock that names another live process grants no signal ownership.
setsid bash -c 'trap "exit 0" TERM INT; while true; do sleep 1; done' bash &
unrelated_pid="$!"
mkdir "$runtime_dir/unrelated-lock"
printf '%s\t%s\n' "$unrelated_pid" "$(process_start_time "$unrelated_pid")" > "$runtime_dir/unrelated-lock/owner"
mv "$runtime_dir/hypr-window-capture-daemon.lock.d" "$runtime_dir/real-daemon-lock"
mv "$runtime_dir/unrelated-lock" "$runtime_dir/hypr-window-capture-daemon.lock.d"
capturectl pause
if process_is_stopped "$unrelated_pid"; then
  exit 1
fi
mv "$runtime_dir/hypr-window-capture-daemon.lock.d" "$runtime_dir/unrelated-lock"
mv "$runtime_dir/real-daemon-lock" "$runtime_dir/hypr-window-capture-daemon.lock.d"
rm -rf "$runtime_dir/unrelated-lock"
kill -TERM -- "-$unrelated_pid" >/dev/null 2>&1 || true
wait "$unrelated_pid" || true
(
  for _ in {1..300}; do
    if [[ -r "$runtime_dir/hypr-window-capture-worker.lock.d/owner" ]]; then
      owner_line="$(<"$runtime_dir/hypr-window-capture-worker.lock.d/owner")"
      owner_pid="${owner_line%%$'\t'*}"
      owner_token="${owner_line#*$'\t'}"
      if [[ "$owner_pid" =~ ^[0-9]+$ && "$owner_pid" != "$stale_pid" && "$owner_token" != stale-token ]]; then
        : > "$stale_owner_seen"
        exit 0
      fi
    fi
    sleep 0.01
  done
  exit 1
) &
stale_owner_monitor_pid="$!"
touch "$stale_trigger"
wait_for_file "$stale_sent" "stale recovery event delivery"
wait "$stale_owner_monitor_pid"
test -e "$stale_owner_seen"

wait "$reader_pid"
reader_pid=""
test ! -e "$reader_failed"
stop_daemon
wait_for_absent "$runtime_dir/hypr-window-capture-worker.lock.d" "worker lock cleanup"
kill -TERM "$event_server_pid" >/dev/null 2>&1 || true
wait "$event_server_pid" || true
event_server_pid=""

# A live, externally recorded worker must survive a competing real daemon.
setsid bash -c 'trap "exit 0" TERM INT; while true; do sleep 1; done' bash &
live_worker_pid="$!"
mkdir "$runtime_dir/hypr-window-capture-worker.lock.d"
printf '%s\tlive-token\n' "$live_worker_pid" > "$runtime_dir/hypr-window-capture-worker.lock.d/owner"

live_trigger="$test_dir/live-trigger"
live_sent="$test_dir/live-sent"
start_event_server "$live_trigger" "$live_sent"
start_daemon
touch "$live_trigger"
wait_for_file "$live_sent" "live-owner event delivery"
wait_for_file "$runtime_dir/hypr-window-capture-worker.lock.d/owner" "live owner record"
owner_line="$(<"$runtime_dir/hypr-window-capture-worker.lock.d/owner")"
owner_pid="${owner_line%%$'\t'*}"
owner_token="${owner_line#*$'\t'}"
test "$owner_pid" = "$live_worker_pid"
test "$owner_token" = live-token

stop_daemon
test -r "$runtime_dir/hypr-window-capture-worker.lock.d/owner"
owner_line="$(<"$runtime_dir/hypr-window-capture-worker.lock.d/owner")"
owner_pid="${owner_line%%$'\t'*}"
owner_token="${owner_line#*$'\t'}"
test "$owner_pid" = "$live_worker_pid"
test "$owner_token" = live-token
kill -TERM -- "-$live_worker_pid" >/dev/null 2>&1 || true
wait "$live_worker_pid" || true
live_worker_pid=""
rm -rf "$runtime_dir/hypr-window-capture-worker.lock.d"
kill -TERM "$event_server_pid" >/dev/null 2>&1 || true
wait "$event_server_pid" || true
event_server_pid=""

printf 'PASS window-capture ownership and pending-event publication\n'

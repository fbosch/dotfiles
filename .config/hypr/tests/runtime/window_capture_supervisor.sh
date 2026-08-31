#!/usr/bin/env bash

set -euo pipefail

if [[ ! -r /proc/self/stat ]]; then
  printf 'SKIP window-capture supervisor requires Linux /proc process identity\n'
  exit 0
fi

test_dir="$(mktemp -d)"
wrapper="$(cd "$(dirname "$0")/../.." && pwd)/runtime/windows/daemons/window-capture/window-capture-daemon.sh"
runtime_dir="$test_dir/runtime"
test_home="$test_dir/home"
daemon="$test_dir/controlled-daemon.sh"
wrapper_pid=""

cleanup() {
  if [[ -n "$wrapper_pid" ]]; then
    kill -TERM "$wrapper_pid" >/dev/null 2>&1 || true
    wait "$wrapper_pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$test_dir"
}
trap cleanup EXIT

wait_for_absent() {
  local path="$1" description="$2"
  for _ in {1..100}; do
    [[ ! -e "$path" ]] && return 0
    sleep 0.01
  done

  printf 'timed out waiting for %s (%s)\n' "$description" "$path" >&2
  return 1
}

mkdir -p "$runtime_dir" "$test_home/.config"
ln -s "$(cd "$(dirname "$0")/../.." && pwd)" "$test_home/.config/hypr"
# shellcheck disable=SC2016
printf '%s\n' '#!/usr/bin/env bash' 'set -eu' 'runtime_dir="$XDG_RUNTIME_DIR"' \
  'daemon_lock="$runtime_dir/hypr/fixture/window-capture-daemon.lock.d"' \
  'worker_lock="$runtime_dir/hypr/fixture/window-capture-worker.lock.d"' \
  'mkdir -p "$daemon_lock" "$worker_lock"' \
  'printf "%s\n" "$$" > "$daemon_lock/pid"' \
  'setsid bash -c '\''printf "%s\n" "$$" > "$1/worker.pid"; trap "exit 0" TERM INT; while true; do sleep 1; done'\'' bash "$runtime_dir" &' \
  'while [[ ! -r "$runtime_dir/worker.pid" ]]; do sleep 0.01; done' \
  'read -r worker_pid < "$runtime_dir/worker.pid"' \
  'printf "%s\tfixture\n" "$worker_pid" > "$worker_lock/owner"' \
  'trap "exit 0" TERM INT' \
  'while true; do sleep 1; done' > "$daemon"
chmod +x "$daemon"

HOME="$test_home" XDG_RUNTIME_DIR="$runtime_dir" HYPRLAND_INSTANCE_SIGNATURE=fixture HYPR_WINDOW_CAPTURE_DAEMON="$daemon" "$wrapper" >/dev/null 2>&1 &
wrapper_pid="$!"

for _ in {1..100}; do
  if [[ -r "$runtime_dir/worker.pid" && -r "$runtime_dir/hypr/fixture/window-capture-worker.lock.d/owner" ]]; then
    break
  fi
  sleep 0.01
done
test -r "$runtime_dir/worker.pid"
test -r "$runtime_dir/hypr/fixture/window-capture-worker.lock.d/owner"
test -r "$runtime_dir/hypr/fixture/window-capture-daemon.lifecycle"
grep -Fq 'state=running' "$runtime_dir/hypr/fixture/window-capture-daemon.lifecycle"
read -r worker_pid < "$runtime_dir/worker.pid"
read -r owner_pid _ < "$runtime_dir/hypr/fixture/window-capture-worker.lock.d/owner"
test "$owner_pid" = "$worker_pid"

worker_exited() {
  local state

  if ! state="$(ps -o stat= -p "$worker_pid" 2>/dev/null)"; then
    return 0
  fi
  state="${state//[[:space:]]/}"
  [[ "$state" == Z* ]]
}

kill -TERM "$wrapper_pid"
wait "$wrapper_pid" || true
wrapper_pid=""
grep -Fq 'state=exited' "$runtime_dir/hypr/fixture/window-capture-daemon.lifecycle"
grep -Fq 'reason=signal' "$runtime_dir/hypr/fixture/window-capture-daemon.lifecycle"
grep -Fq 'detail=TERM' "$runtime_dir/hypr/fixture/window-capture-daemon.lifecycle"

for _ in {1..100}; do
  if worker_exited; then
    break
  fi
  sleep 0.01
done

if ! worker_exited; then
  printf 'window-capture supervisor left worker %s running\n' "$worker_pid" >&2
  exit 1
fi
wait_for_absent "$runtime_dir/hypr/fixture/window-capture-daemon.lock.d" "daemon lock cleanup"

real_runtime_dir="$test_dir/real-runtime"
real_capture_dir="$test_dir/real-captures"
mkdir -p "$real_runtime_dir" "$real_capture_dir"

HOME="$test_home" \
  XDG_RUNTIME_DIR="$real_runtime_dir" \
  HYPRLAND_INSTANCE_SIGNATURE=fixture \
  HYPR_WINDOW_CAPTURE_DIR="$real_capture_dir" \
  "$wrapper" >/dev/null 2>&1 &
wrapper_pid="$!"

for _ in {1..100}; do
  [[ -r "$real_runtime_dir/hypr/fixture/window-capture-daemon.lock.d/pid" ]] && break
  sleep 0.01
done
test -r "$real_runtime_dir/hypr/fixture/window-capture-daemon.lock.d/pid"
daemon_pid="$(<"$real_runtime_dir/hypr/fixture/window-capture-daemon.lock.d/pid")"
daemon_parent_pid="$(ps -o ppid= -p "$daemon_pid" | tr -d '[:space:]')"
test "$daemon_parent_pid" = "$wrapper_pid"

kill -TERM "$wrapper_pid"
wait "$wrapper_pid" || true
wrapper_pid=""

wait_for_absent "$real_runtime_dir/hypr/fixture/window-capture-daemon.lock.d" "real daemon lock cleanup"
for _ in {1..100}; do
  kill -0 "$daemon_pid" >/dev/null 2>&1 || break
  sleep 0.01
done
if kill -0 "$daemon_pid" >/dev/null 2>&1; then
  printf 'window-capture supervisor left real daemon %s running\n' "$daemon_pid" >&2
  exit 1
fi

printf 'PASS window-capture supervisor reaps its worker group\n'

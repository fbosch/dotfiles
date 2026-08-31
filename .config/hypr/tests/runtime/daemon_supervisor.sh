#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
test_dir="$(mktemp -d)"
socket_path="$test_dir/fixture.sock"
lock_file="$test_dir/fixture.lock"
launcher="$test_dir/fixture-launcher.sh"
worker="$test_dir/fixture-worker.sh"
worker_lua="$test_dir/fixture-worker.lua"
restart_delay_file="$test_dir/restart-delay"
supervisor_pid=""
unmanaged_pid=""
printf '0.3\n' > "$restart_delay_file"

cleanup() {
  if [[ -n "$supervisor_pid" ]] && kill -0 "$supervisor_pid" >/dev/null 2>&1; then
    kill -TERM "$supervisor_pid" >/dev/null 2>&1 || true
    wait "$supervisor_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$unmanaged_pid" ]] && kill -0 "$unmanaged_pid" >/dev/null 2>&1; then
    kill -TERM "$unmanaged_pid" >/dev/null 2>&1 || true
    wait "$unmanaged_pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$test_dir"
}
trap cleanup EXIT

cat > "$worker_lua" <<'LUA'
local socket = require("socket")
local unix = require("socket.unix")

local path = assert(arg[1])
local restart_delay_file = assert(arg[2])
os.remove(path)
local exit_status = 0
local server = assert(unix())
assert(server:bind(path))
assert(server:listen())
server:settimeout(0.05)

while true do
	local client = server:accept()
	if client then
		client:settimeout(0.1)
		local message = client:receive("*l")
		client:send("ok\n")
		client:close()
		if message == "restart" then
			exit_status = 75
			local delay_handle = assert(io.open(restart_delay_file, "r"))
			local restart_delay = tonumber(delay_handle:read("*l")) or 0
			delay_handle:close()
			socket.sleep(restart_delay)
			break
		end
		if message == "quit" then
			socket.sleep(0.3)
			break
		end
	end
end

server:close()
os.remove(path)
os.exit(exit_status == 0 and 0 or tonumber(os.getenv("DAEMON_SUPERVISOR_RESTART_EXIT_STATUS")))
LUA

cat > "$worker" <<'SH'
#!/bin/sh
set -eu
exec luajit "$2" "$1" "$3"
SH
chmod +x "$worker"

cat > "$launcher" <<SH
#!/bin/sh
set -eu
daemon_supervisor_name="fixture"
daemon_supervisor_socket="$socket_path"
daemon_supervisor_lock_file="$lock_file"
daemon_supervisor_health_timeout=0.1
daemon_supervisor_start_attempts=20
daemon_supervisor_start_interval=0.02
daemon_supervisor_health_attempts=20
daemon_supervisor_shutdown_commands="quit"
daemon_supervisor_shutdown_attempts=50
daemon_supervisor_shutdown_interval=0.02
daemon_supervisor_restart_attempts="\${FIXTURE_RESTART_ATTEMPTS:-100}"
daemon_supervisor_cleanup_paths=""
. "$repo_root/runtime/lib/daemon-lifecycle.sh"
. "$repo_root/runtime/lib/daemon-supervisor.sh"
daemon_supervisor_main "\$@" -- "$worker" "$socket_path" "$worker_lua" "$restart_delay_file"
SH
chmod +x "$launcher"

wait_for_health() {
  local attempts=0 response
  while (( attempts < 100 )); do
    response="$(printf 'ping\n' | timeout 0.2 nc -w 1 -U "$socket_path" 2>/dev/null || true)"
    if [[ "$response" == "ok" ]]; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 0.02
  done
  printf 'daemon-supervisor test: health check timed out\n' >&2
  return 1
}

export XDG_RUNTIME_DIR="$test_dir"
"$launcher" >"$test_dir/first.out" 2>"$test_dir/first.err" &
first_supervisor_pid="$!"
supervisor_pid="$first_supervisor_pid"
wait_for_health
first_worker_pid="$(pgrep -P "$first_supervisor_pid")"
[[ -n "$first_worker_pid" ]]
grep -Fq 'state=running' "$lock_file.lifecycle"
grep -Fq "child_pid=$first_worker_pid" "$lock_file.lifecycle"

set +e
invalid_output="$("$launcher" invalid 2>&1)"
invalid_status="$?"
set -e
[[ "$invalid_status" -eq 2 ]]
[[ "$invalid_output" == *"unknown action: invalid"* ]]
kill -0 "$first_supervisor_pid"
wait_for_health

[[ "$("$launcher" --help)" == "Usage: fixture-launcher.sh [start|restart]" ]]

"$launcher" restart >"$test_dir/restart.out" 2>"$test_dir/restart.err"
kill -0 "$first_supervisor_pid"
wait_for_health
second_worker_pid="$(pgrep -P "$first_supervisor_pid")"
[[ -n "$second_worker_pid" ]]
[[ "$second_worker_pid" != "$first_worker_pid" ]]
if kill -0 "$first_worker_pid" >/dev/null 2>&1; then
  printf 'daemon-supervisor test: old worker %s is still running\n' "$first_worker_pid" >&2
  exit 1
fi

IFS=$'\t' read -r _ generation_before_concurrency _ < "$lock_file.state"
"$launcher" restart >"$test_dir/concurrent-first.out" 2>"$test_dir/concurrent-first.err" &
first_restart_pid="$!"
sleep 0.05
"$launcher" restart >"$test_dir/concurrent-second.out" 2>"$test_dir/concurrent-second.err" &
second_restart_pid="$!"
wait "$first_restart_pid"
wait "$second_restart_pid"
IFS=$'\t' read -r _ generation_after_concurrency concurrent_worker_pid < "$lock_file.state"
[[ "$generation_after_concurrency" -eq $((generation_before_concurrency + 1)) ]]
[[ "$(pgrep -P "$first_supervisor_pid")" == "$concurrent_worker_pid" ]]

generation_before_timeout="$generation_after_concurrency"
set +e
timeout_output="$(FIXTURE_RESTART_ATTEMPTS=2 "$launcher" restart 2>&1)"
timeout_status="$?"
set -e
[[ "$timeout_status" -eq 1 ]]
[[ "$timeout_output" == *"replacement daemon did not become healthy"* ]]
wait_for_health
IFS=$'\t' read -r _ generation_after_timeout concurrent_worker_pid < "$lock_file.state"
[[ "$generation_after_timeout" -eq $((generation_before_timeout + 1)) ]]

kill -TERM "$first_supervisor_pid"
wait "$first_supervisor_pid"
supervisor_pid=""
[[ ! -S "$socket_path" ]]
grep -Fq 'state=exited' "$lock_file.lifecycle"
grep -Fq 'reason=signal' "$lock_file.lifecycle"
grep -Fq 'detail=TERM' "$lock_file.lifecycle"
grep -Fq 'status=0' "$lock_file.lifecycle"
if kill -0 "$concurrent_worker_pid" >/dev/null 2>&1; then
  printf 'daemon-supervisor test: worker %s survived supervisor shutdown\n' "$concurrent_worker_pid" >&2
  exit 1
fi

"$worker" "$socket_path" "$worker_lua" "$restart_delay_file" >"$test_dir/unmanaged.out" 2>"$test_dir/unmanaged.err" &
unmanaged_pid="$!"
wait_for_health

flock_stub_dir="$test_dir/flock-stub"
mkdir "$flock_stub_dir"
cat > "$flock_stub_dir/flock" <<'SH'
#!/bin/sh
case " $* " in
  *" -E 200 -n "*) exit 75 ;;
  *) exec "$REAL_FLOCK" "$@" ;;
esac
SH
chmod +x "$flock_stub_dir/flock"
set +e
flock_error_output="$(REAL_FLOCK="$(command -v flock)" PATH="$flock_stub_dir:$PATH" "$launcher" restart 2>&1)"
flock_error_status="$?"
set -e
[[ "$flock_error_status" -eq 1 ]]
[[ "$flock_error_output" == *"could not verify supervisor lock ownership"* ]]
kill -0 "$unmanaged_pid"

set +e
unmanaged_output="$("$launcher" restart 2>&1)"
unmanaged_status="$?"
set -e
[[ "$unmanaged_status" -eq 1 ]]
[[ "$unmanaged_output" == *"healthy socket is not owned by a supervisor"* ]]
kill -0 "$unmanaged_pid"
wait_for_health
printf 'quit\n' | nc -w 1 -U "$socket_path" >/dev/null
wait "$unmanaged_pid"
unmanaged_pid=""

printf 'PASS daemon supervisor validates ownership and restarts its worker generation\n'

#!/usr/bin/env bash

set -euo pipefail

if [[ ! -r /proc/self/stat ]]; then
  printf 'SKIP night-light lifecycle requires Linux /proc process identity\n'
  exit 0
fi

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
test_dir="$(mktemp -d)"
runtime_dir="$test_dir/runtime"
bin_dir="$test_dir/bin"
home_dir="$test_dir/home"
original_path="$PATH"
luajit_path="$(command -v luajit)"

cleanup() {
  if [[ -n "${daemon_pid:-}" ]]; then
    kill -TERM -- "-$daemon_pid" >/dev/null 2>&1 || true
    wait "$daemon_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "${unrelated_pid:-}" ]]; then
    kill -TERM "$unrelated_pid" >/dev/null 2>&1 || true
    wait "$unrelated_pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$test_dir"
}
trap cleanup EXIT

mkdir -p "$bin_dir" "$home_dir" "$runtime_dir/hypr/fixture"

wait_for_file() {
  local file="$1" description="$2" attempts=0
  while [[ ! -s "$file" ]]; do
    if ((attempts >= 60)); then
      printf 'timed out waiting for %s (%s)\n' "$description" "$file" >&2
      exit 1
    fi
    attempts=$((attempts + 1))
    sleep 0.05
  done
}

wait_for_pid_gone() {
  local pid="$1" description="$2" attempts=0
  while [[ -e "/proc/$pid" ]]; do
    if ((attempts >= 60)); then
      printf 'timed out waiting for %s (pid %s)\n' "$description" "$pid" >&2
      exit 1
    fi
    attempts=$((attempts + 1))
    sleep 0.05
  done
}

wait_for_socket() {
  local socket="$1" description="$2" attempts=0
  while [[ ! -S "$socket" ]]; do
    if ((attempts >= 60)); then
      printf 'timed out waiting for %s (%s)\n' "$description" "$socket" >&2
      exit 1
    fi
    attempts=$((attempts + 1))
    sleep 0.05
  done
}

assert_pid_not_running() {
  local pid="$1" description="$2" state
  if [[ ! -e "/proc/$pid" ]]; then
    return
  fi
  state="$(awk '{ print $3 }' "/proc/$pid/stat")"
  [[ "$state" == Z ]] || {
    printf '%s: pid %s is still running (state %s)\n' "$description" "$pid" "$state" >&2
    exit 1
  }
}

assert_file_line_count() {
  local file="$1" expected="$2" description="$3" actual
  actual="$(wc -l < "$file")"
  if [[ "$actual" != "$expected" ]]; then
    printf '%s: expected %s lines, got %s\n' "$description" "$expected" "$actual" >&2
    exit 1
  fi
}

# Keep the real utilities available while making the clock deterministic and
# making the IPC failure a one-shot fixture event.
cat > "$bin_dir/date" <<'EOF'
#!/bin/sh
if [ "$*" = "+%s" ]; then
  printf '0\n'
  exit 0
fi
exec DATE_REAL "$@"
EOF
sed -i "s#DATE_REAL#$(command -v date)#" "$bin_dir/date"

cat > "$bin_dir/nc" <<'EOF'
#!/bin/sh
if [ -e "$FIXTURE_FAIL_IPC" ]; then
  IFS= read -r count < "$FIXTURE_FAIL_IPC"
  if [ "$count" -gt 1 ]; then
    printf '%s\n' "$((count - 1))" > "$FIXTURE_FAIL_IPC"
  else
    rm -f "$FIXTURE_FAIL_IPC"
  fi
  exit 1
fi
printf '%s\n' "$*" >> "$FIXTURE_IPC_LOG"
printf 'ok\n'
EOF

cat > "$bin_dir/hyprsunset" <<EOF
#!/bin/sh
printf '%s\n' "\$" >> "\$FIXTURE_START_LOG"
exec "$luajit_path" "$test_dir/fake-hyprsunset.lua" "\$@"
EOF

cat > "$test_dir/fake-hyprsunset.lua" <<'EOF'
local ffi = require("ffi")

ffi.cdef[[
  int prctl(int option, ...);
  int socket(int domain, int type, int protocol);
  int bind(int socket, const void *address, unsigned int address_length);
  int listen(int socket, int backlog);
  unsigned int sleep(unsigned int seconds);
  int close(int fd);
  int unlink(const char *path);
  typedef void (*sighandler_t)(int);
  sighandler_t signal(int signal, sighandler_t handler);
  typedef unsigned short sa_family_t;
  struct sockaddr_un {
    sa_family_t sun_family;
    char sun_path[108];
  };
]]

local AF_UNIX = 1
local SOCK_STREAM = 1
local PR_SET_NAME = 15
local socket_path = os.getenv("HYPRSUNSET_SOCKET")
assert(socket_path, "HYPRSUNSET_SOCKET is required")

assert(ffi.C.prctl(PR_SET_NAME, "hyprsunset", 0, 0, 0) == 0, "prctl failed")
ffi.C.unlink(socket_path)
local fd = assert(ffi.C.socket(AF_UNIX, SOCK_STREAM, 0), "socket failed")
local address = ffi.new("struct sockaddr_un")
address.sun_family = AF_UNIX
ffi.copy(address.sun_path, socket_path, #socket_path)
assert(ffi.C.bind(fd, address, 2 + #socket_path) == 0, "bind failed")
assert(ffi.C.listen(fd, 1) == 0, "listen failed")
local term_handler = ffi.cast("sighandler_t", function()
  ffi.C.unlink(socket_path)
  os.exit(0)
end)
ffi.C.signal(15, term_handler)

while true do
  ffi.C.sleep(1)
end
EOF

chmod +x "$bin_dir/date" "$bin_dir/nc" "$bin_dir/hyprsunset"

export HOME="$home_dir"
export PATH="$bin_dir:$original_path"
export XDG_RUNTIME_DIR="$runtime_dir"
export HYPRLAND_INSTANCE_SIGNATURE=fixture
export HYPRSUNSET_SOCKET="$runtime_dir/hypr/fixture/.hyprsunset.sock"
export FIXTURE_FAIL_IPC="$test_dir/fail-ipc"
export FIXTURE_IPC_LOG="$test_dir/ipc.log"
export FIXTURE_START_LOG="$test_dir/start.log"
daemon_log="$test_dir/daemon.log"

state_dir="$runtime_dir/hypr-night-light"
mkdir -p "$state_dir"
printf 'on\n' > "$state_dir/override"
printf '9999999999\n' > "$state_dir/override-expiry"

setsid env NIGHT_LIGHT_LOCK_HELD=true "$repo_root/runtime/desktop/night-light.sh" daemon > "$daemon_log" 2>&1 &
daemon_pid="$!"
wait_for_file "$state_dir/hyprsunset-owner" 'owned hyprsunset owner record'
read -r original_child_pid original_child_start < "$state_dir/hyprsunset-owner"
[[ "$original_child_pid" =~ ^[0-9]+$ && "$original_child_start" =~ ^[0-9]+$ ]] || {
  printf 'owner record is not PID plus start time\n' >&2
  exit 1
}
[[ -r "/proc/$original_child_pid/comm" ]] || {
  printf 'owned child pid is not live\n' >&2
  exit 1
}
[[ "$(< "/proc/$original_child_pid/comm")" == hyprsunset ]] || {
  printf 'owned child has unexpected process name\n' >&2
  exit 1
}

printf '2\n' > "$FIXTURE_FAIL_IPC"
"$repo_root/runtime/desktop/night-light.sh" sync
read -r restarted_child_pid restarted_child_start < "$state_dir/hyprsunset-owner"
[[ "$restarted_child_pid" != "$original_child_pid" ]] || {
  printf 'IPC recovery did not replace the owned child\n' >&2
  exit 1
}
[[ "$restarted_child_start" =~ ^[0-9]+$ ]] || {
  printf 'restarted owner record has no start time\n' >&2
  exit 1
}
assert_pid_not_running "$original_child_pid" 'old owned child after IPC recovery'
assert_file_line_count "$FIXTURE_START_LOG" 2 'one owned-child restart'
assert_file_line_count "$state_dir/hyprsunset-owner" 1 'owned owner record'

kill -TERM -- "-$daemon_pid"
wait "$daemon_pid"
unset daemon_pid
wait_for_pid_gone "$restarted_child_pid" 'owned child after daemon termination'
[[ ! -e "$state_dir/hyprsunset-owner" ]] || {
  printf 'daemon termination left an owned child record\n' >&2
  exit 1
}
rm -f "$HYPRSUNSET_SOCKET"

"$bin_dir/hyprsunset" --unrelated &
unrelated_pid="$!"
wait_for_socket "$HYPRSUNSET_SOCKET" 'unrelated hyprsunset socket'
printf '%s 1\n' "$unrelated_pid" > "$state_dir/hyprsunset-owner"
if "$repo_root/runtime/desktop/night-light.sh" sync; then
  printf 'sync unexpectedly replaced an unrelated hyprsunset\n' >&2
  exit 1
fi
kill -0 "$unrelated_pid" 2>/dev/null || {
  printf 'stale owner validation killed the unrelated hyprsunset\n' >&2
  exit 1
}

printf 'PASS night-light owned-child lifecycle and IPC recovery\n'

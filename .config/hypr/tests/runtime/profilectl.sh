#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
profilectl="$repo_root/runtime/profiles/profilectl.sh"
profile_state_helper="$repo_root/runtime/profiles/profile-state.lua"
test_dir="$(mktemp -d)"
bin_dir="$test_dir/bin"
home_dir="$test_dir/home"
runtime_dir="$test_dir/runtime"
actuator_log="$test_dir/actuator.log"
seam_dir="$test_dir/seams"
real_mv="$(command -v mv)"

cleanup() {
  rm -rf "$test_dir"
}
trap cleanup EXIT

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

assert_file_equals() {
  local file="$1" expected="$2" actual

  [[ -r "$file" ]] || fail "missing file: $file"
  actual="$(<"$file")"
  [[ "$actual" == "$expected" ]] || fail "expected $file to contain $expected, got $actual"
}

assert_absent() {
  local file="$1"

  [[ ! -e "$file" ]] || fail "expected $file to be absent"
}

assert_file_contains() {
  local file="$1" expected="$2" actual

  [[ -r "$file" ]] || fail "missing file: $file"
  actual="$(<"$file")"
  [[ "$actual" == *"$expected"* ]] || fail "expected $file to contain $expected"
}

assert_file_not_contains() {
  local file="$1" unexpected="$2" actual

  [[ -r "$file" ]] || fail "missing file: $file"
  actual="$(<"$file")"
  [[ "$actual" != *"$unexpected"* ]] || fail "expected $file not to contain $unexpected"
}

assert_state_generation() {
  local file="$1" expected="$2" actual

  actual="$(luajit "$home_dir/.config/hypr/runtime/profiles/profile-state.lua" generation "$file")" \
    || fail "invalid profile state: $file"
  [[ "$actual" == "$expected" ]] || fail "expected profile state generation $expected, got $actual"
}

wait_for_file() {
  local file="$1"
  local attempts=100

  while [[ ! -e "$file" && "$attempts" -gt 0 ]]; do
    sleep 0.01
    attempts=$((attempts - 1))
  done

  [[ -e "$file" ]] || fail "timed out waiting for $file"
}

reset_profile_state() {
  rm -rf "$runtime_dir/hypr-profiles"
}

write_raw_state_fixture() {
  mkdir -p "$runtime_dir/hypr-profiles"
  printf "%s" "$1" > "$runtime_dir/hypr-profiles/state.json"
}

write_stub() {
  local name="$1"

  # shellcheck disable=SC2016
  printf '%s\n' '#!/bin/sh' 'printf "%s %s\n" "${0##*/}" "$*" >> "$ACTUATOR_LOG"' 'if [ "${PROFILECTL_TEST_FAIL_CAPTURE_REFRESH:-0}" = 1 ] && [ "$1" = refresh ]; then exit 1; fi' 'exit 0' > "$bin_dir/$name"
  chmod +x "$bin_dir/$name"
}

mkdir -p "$bin_dir" "$home_dir/.config/hypr/runtime/profiles" "$home_dir/.config/hypr/runtime/windows/daemons/window-capture" "$home_dir/.config/hypr/lib" "$runtime_dir" "$seam_dir"
ln -s "$profilectl" "$home_dir/.config/hypr/runtime/profiles/profilectl.sh"
ln -s "$profile_state_helper" "$home_dir/.config/hypr/runtime/profiles/profile-state.lua"
ln -s "$repo_root/lib/json.lua" "$home_dir/.config/hypr/lib/json.lua"
ln -s "$repo_root/lib/profile_state.lua" "$home_dir/.config/hypr/lib/profile_state.lua"
write_stub ags
write_stub pkill
write_stub powerprofilesctl
write_stub window-capturectl
ln -s "$bin_dir/window-capturectl" "$home_dir/.config/hypr/runtime/windows/daemons/window-capture/window-capturectl.sh"

cat > "$bin_dir/hyprctl" <<'EOF'
#!/usr/bin/env bash
printf '%s %s\n' "${0##*/}" "$*" >> "$ACTUATOR_LOG"

target=""
if [[ "$1" == reload ]]; then
  target="reload"
elif [[ "$1" == eval && "$2" == 'require("profiles").apply("default")' ]]; then
  target="default"
elif [[ "$1" == eval && "$2" == 'require("profiles").apply("gaming")' ]]; then
  target="gaming"
elif [[ "$1" == eval && "$2" == 'require("profiles").apply("powersave")' ]]; then
  target="powersave"
fi

if [[ -n "${PROFILECTL_TEST_HYPRCTL_BLOCK_TARGET:-}" && "${PROFILECTL_TEST_HYPRCTL_BLOCK_TARGET}" == "$target" ]]; then
  : > "${PROFILECTL_TEST_ACTUATOR_READY_FILE:?}"
  trap 'printf "hyprctl terminated %s\n" "$target" >> "$ACTUATOR_LOG"; exit 143' TERM INT
  while [[ ! -e "${PROFILECTL_TEST_ACTUATOR_RELEASE_FILE:?}" ]]; do
    sleep 0.01
  done
fi

if [[ -n "${PROFILECTL_TEST_HYPRCTL_INTERRUPT_TARGET:-}" && "${PROFILECTL_TEST_HYPRCTL_INTERRUPT_TARGET}" == "$target" ]]; then
  controller_pid="${PROFILECTL_TEST_CONTROLLER_PID:?}"
  case "${PROFILECTL_TEST_HYPRCTL_INTERRUPT_PHASE:?}" in
    before-actuation)
      kill -TERM "$controller_pid"
      exit 143
      ;;
    after-actuation)
      printf 'hyprctl applied %s\n' "$target" >> "$ACTUATOR_LOG"
      kill -TERM "$controller_pid"
      exit 143
      ;;
  esac
fi

if [ "${HYPRCTL_FAIL_DEFAULT:-0}" = 1 ] && [ "$target" = default ]; then
  exit 1
fi
if [ "${HYPRCTL_FAIL_GAMING:-0}" = 1 ] && [ "$target" = gaming ]; then
  exit 1
fi
EOF
chmod +x "$bin_dir/hyprctl"

cat > "$bin_dir/mv" <<'EOF'
#!/usr/bin/env bash
destination="${!#}"
state_file="${XDG_RUNTIME_DIR}/hypr-profiles/state.json"

if [[ "${PROFILECTL_TEST_HOLD_STATE_RENAME:-0}" = 1 && "$destination" == "$state_file" ]]; then
  : > "${PROFILECTL_TEST_RENAME_READY_FILE:?}"
  trap 'exit 143' TERM INT
  while [[ ! -e "${PROFILECTL_TEST_RENAME_RELEASE_FILE:?}" ]]; do
    sleep 0.01
  done
fi

if [[ "${PROFILECTL_TEST_FAIL_STATE_RENAME:-0}" = 1 && "$destination" == "$state_file" ]]; then
  exit 1
fi

exec "${PROFILECTL_TEST_REAL_MV:?}" "$@"
EOF
chmod +x "$bin_dir/mv"

run_profilectl() {
  HOME="$home_dir" \
    PATH="$bin_dir:$PATH" \
    XDG_RUNTIME_DIR="$runtime_dir" \
    ACTUATOR_LOG="$actuator_log" \
    PROFILECTL_TEST_REAL_MV="$real_mv" \
    "$profilectl" "$@"
}

start_profilectl() {
  (
    export PROFILECTL_TEST_CONTROLLER_PID="$BASHPID"
    exec env \
      HOME="$home_dir" \
      PATH="$bin_dir:$PATH" \
      XDG_RUNTIME_DIR="$runtime_dir" \
      ACTUATOR_LOG="$actuator_log" \
      PROFILECTL_TEST_REAL_MV="$real_mv" \
      "$profilectl" "$@"
  ) &
  profilectl_pid=$!
}

assert_file_not_contains "$profilectl" "ags request"
assert_file_not_contains "$profilectl" "window-switcher"
assert_file_not_contains "$profilectl" "pkill -STOP"
assert_file_not_contains "$profilectl" "pkill -CONT"
assert_file_not_contains "$profilectl" "window-capture-daemon.lua"

reset_profile_state
: > "$actuator_log"
run_profilectl sync-source powersave idle 1
assert_file_equals "$runtime_dir/hypr-profiles/state.json" '{"generation":1,"resolved":"powersave","selection":"auto","sources":{"gaming":{},"powersave":{"idle":1}}}'
assert_absent "$runtime_dir/hypr-profiles/powersave.idle.count"
assert_absent "$runtime_dir/hypr-profiles/manual-selection"
assert_absent "$runtime_dir/hypr-profiles/profile-overlay.mode"
assert_absent "$runtime_dir/hypr-profiles/profile-overlay.active"
assert_file_not_contains "$actuator_log" "ags request"
assert_file_contains "$actuator_log" "window-capturectl.sh pause"
json_status="$(run_profilectl status --json)"
[[ "$json_status" == "$(< "$runtime_dir/hypr-profiles/state.json")" ]] || fail "JSON status did not return canonical state"

reset_profile_state
run_profilectl sync-source gaming watchdog 1
state_before="$(< "$runtime_dir/hypr-profiles/state.json")"
: > "$actuator_log"
run_profilectl sync-source gaming watchdog 1
assert_file_equals "$runtime_dir/hypr-profiles/state.json" "$state_before"
assert_file_equals "$actuator_log" ""

reset_profile_state
run_profilectl sync-source gaming watchdog 1
run_profilectl sync-source powersave idle 1
run_profilectl sync-source gaming gamemode 1
run_profilectl sync-source gaming watchdog 0
assert_file_contains "$runtime_dir/hypr-profiles/state.json" '"resolved":"gaming"'
run_profilectl sync-source gaming gamemode 0
assert_file_contains "$runtime_dir/hypr-profiles/state.json" '"resolved":"powersave"'
run_profilectl sync-source powersave idle 0
assert_file_contains "$runtime_dir/hypr-profiles/state.json" '"resolved":"default"'

reset_profile_state
run_profilectl sync-source gaming watchdog 1
run_profilectl set-manual default
assert_file_equals "$runtime_dir/hypr-profiles/state.json" '{"generation":2,"resolved":"default","selection":"default","sources":{"gaming":{"watchdog":1},"powersave":{}}}'
run_profilectl clear-manual
assert_file_contains "$runtime_dir/hypr-profiles/state.json" '"resolved":"gaming"'
run_profilectl set-manual powersave
assert_file_contains "$runtime_dir/hypr-profiles/state.json" '"selection":"powersave"'
run_profilectl clear-manual
assert_file_contains "$runtime_dir/hypr-profiles/state.json" '"selection":"auto"'

reset_profile_state
if HYPRCTL_FAIL_DEFAULT=1 run_profilectl clear-manual; then
  fail "profilectl accepted a failed default application"
fi
assert_absent "$runtime_dir/hypr-profiles/state.json"

reset_profile_state
if HYPRCTL_FAIL_GAMING=1 HYPRCTL_FAIL_DEFAULT=1 run_profilectl apply gaming >/dev/null 2>&1; then
  fail "profilectl succeeded after Gaming activation and rollback both failed"
fi
assert_absent "$runtime_dir/hypr-profiles/state.json"

reset_profile_state
write_raw_state_fixture '{"selection":'
: > "$actuator_log"
if run_profilectl sync-source gaming watchdog 1 >/dev/null 2>&1; then
  fail "profilectl accepted malformed canonical state"
fi
assert_file_equals "$runtime_dir/hypr-profiles/state.json" '{"selection":'
assert_file_equals "$actuator_log" ""

reset_profile_state
write_raw_state_fixture '{"generation":7,"resolved":"gaming","selection":"default","sources":{"gaming":{},"powersave":{}}}'
: > "$actuator_log"
if run_profilectl sync-source gaming watchdog 1 >/dev/null 2>&1; then
  fail "profilectl accepted inconsistent canonical state"
fi
assert_file_equals "$actuator_log" ""

reset_profile_state
run_profilectl sync-source gaming watchdog 1
assert_state_generation "$runtime_dir/hypr-profiles/state.json" "1"
run_profilectl sync-source powersave idle 1
assert_state_generation "$runtime_dir/hypr-profiles/state.json" "2"
run_profilectl set-manual default
assert_file_equals "$runtime_dir/hypr-profiles/state.json" '{"generation":3,"resolved":"default","selection":"default","sources":{"gaming":{"watchdog":1},"powersave":{"idle":1}}}'
run_profilectl clear-manual
assert_state_generation "$runtime_dir/hypr-profiles/state.json" "4"

reset_profile_state
run_profilectl sync-source gaming watchdog 1
state_before="$(< "$runtime_dir/hypr-profiles/state.json")"
rename_ready="$seam_dir/rename-ready"
rename_release="$seam_dir/rename-release"
rm -f "$rename_ready" "$rename_release"
export PROFILECTL_TEST_HOLD_STATE_RENAME=1
export PROFILECTL_TEST_RENAME_READY_FILE="$rename_ready"
export PROFILECTL_TEST_RENAME_RELEASE_FILE="$rename_release"
start_profilectl sync-source powersave idle 1
wait_for_file "$rename_ready"
assert_file_equals "$runtime_dir/hypr-profiles/state.json" "$state_before"
touch "$rename_release"
wait "$profilectl_pid"
assert_state_generation "$runtime_dir/hypr-profiles/state.json" "2"
unset PROFILECTL_TEST_HOLD_STATE_RENAME PROFILECTL_TEST_RENAME_READY_FILE PROFILECTL_TEST_RENAME_RELEASE_FILE

reset_profile_state
run_profilectl sync-source gaming watchdog 1
state_before="$(< "$runtime_dir/hypr-profiles/state.json")"
if PROFILECTL_TEST_FAIL_STATE_RENAME=1 run_profilectl sync-source powersave idle 1 >/dev/null 2>&1; then
  fail "profilectl succeeded after canonical state publication failed"
fi
assert_file_equals "$runtime_dir/hypr-profiles/state.json" "$state_before"
assert_file_not_contains "$runtime_dir/hypr-profiles/state.json" '"idle"'
run_profilectl reconcile
assert_file_equals "$runtime_dir/hypr-profiles/state.json" '{"generation":2,"resolved":"gaming","selection":"auto","sources":{"gaming":{"watchdog":1},"powersave":{}}}'

if luajit "$home_dir/.config/hypr/runtime/profiles/profile-state.lua" encode 1 auto default >/dev/full 2>/dev/null; then
  fail "profile state helper reported success after a write failure"
fi

oversized_claims="$seam_dir/oversized-claims"
for index in {1..7000}; do
  printf 'gaming\tclaim-%s\t1\n' "$index" >> "$oversized_claims"
done
if luajit "$home_dir/.config/hypr/runtime/profiles/profile-state.lua" encode 1 auto gaming < "$oversized_claims" >/dev/null 2>&1; then
  fail "profile state helper accepted an oversized snapshot"
fi

actuator_ready="$seam_dir/actuator-ready"
actuator_release="$seam_dir/actuator-release"
: > "$actuator_log"
ACTUATOR_LOG="$actuator_log" \
  PROFILECTL_TEST_HYPRCTL_BLOCK_TARGET=gaming \
  PROFILECTL_TEST_ACTUATOR_READY_FILE="$actuator_ready" \
  PROFILECTL_TEST_ACTUATOR_RELEASE_FILE="$actuator_release" \
  "$bin_dir/hyprctl" eval 'require("profiles").apply("gaming")' &
actuator_pid=$!
wait_for_file "$actuator_ready"
kill -TERM "$actuator_pid"
if wait "$actuator_pid"; then
  fail "blocked actuator did not terminate"
fi
assert_file_contains "$actuator_log" 'hyprctl terminated gaming'

reset_profile_state
export PROFILECTL_TEST_HYPRCTL_INTERRUPT_TARGET=gaming
export PROFILECTL_TEST_HYPRCTL_INTERRUPT_PHASE=before-actuation
start_profilectl apply gaming
if wait "$profilectl_pid"; then
  fail "controller survived interruption before actuation"
fi
assert_absent "$runtime_dir/hypr-profiles/state.json"

reset_profile_state
: > "$actuator_log"
export PROFILECTL_TEST_HYPRCTL_INTERRUPT_PHASE=after-actuation
start_profilectl apply gaming
if wait "$profilectl_pid"; then
  fail "controller survived interruption after actuation"
fi
assert_file_contains "$actuator_log" 'hyprctl applied gaming'
assert_absent "$runtime_dir/hypr-profiles/state.json"
unset PROFILECTL_TEST_HYPRCTL_INTERRUPT_TARGET PROFILECTL_TEST_HYPRCTL_INTERRUPT_PHASE

reset_profile_state
: > "$actuator_log"
run_profilectl set-manual gaming
run_profilectl clear-manual
sleep 0.4
assert_file_contains "$actuator_log" "window-capturectl.sh pause"
assert_file_contains "$actuator_log" "window-capturectl.sh resume"
assert_file_contains "$actuator_log" "window-capturectl.sh refresh"
assert_absent "$runtime_dir/hypr-profiles/gaming.manual.count"
assert_absent "$runtime_dir/hypr-profiles/profile-overlay.mode"

printf 'PASS profilectl fixture uses canonical state for profile policy\n'

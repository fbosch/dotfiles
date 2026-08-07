#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
profilectl="$repo_root/runtime/profiles/profilectl.sh"
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
  printf '%s\n' '#!/bin/sh' 'printf "%s %s\n" "${0##*/}" "$*" >> "$ACTUATOR_LOG"' 'exit 0' > "$bin_dir/$name"
  chmod +x "$bin_dir/$name"
}

mkdir -p "$bin_dir" "$home_dir/.config/hypr/runtime/profiles" "$runtime_dir" "$seam_dir"
ln -s "$profilectl" "$home_dir/.config/hypr/runtime/profiles/profilectl.sh"
write_stub ags
write_stub pkill
write_stub powerprofilesctl

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

reset_profile_state
run_profilectl sync-source powersave idle 1
assert_file_equals "$runtime_dir/hypr-profiles/powersave.idle.count" "1"
assert_file_equals "$runtime_dir/hypr-profiles/profile-overlay.mode" "powersave"

reset_profile_state
run_profilectl sync gaming 1
assert_file_equals "$runtime_dir/hypr-profiles/gaming.watchdog.count" "1"
assert_file_equals "$runtime_dir/hypr-profiles/profile-overlay.mode" "gaming"
run_profilectl sync-source powersave idle 1
assert_file_equals "$runtime_dir/hypr-profiles/profile-overlay.mode" "gaming"
run_profilectl sync-source gaming gamemode 1
run_profilectl sync gaming 0
assert_file_equals "$runtime_dir/hypr-profiles/profile-overlay.mode" "gaming"
run_profilectl sync-source gaming gamemode 0
assert_file_equals "$runtime_dir/hypr-profiles/profile-overlay.mode" "powersave"
run_profilectl sync-source powersave idle 0
assert_absent "$runtime_dir/hypr-profiles/profile-overlay.mode"

reset_profile_state
run_profilectl sync gaming 1
run_profilectl set-manual default
assert_absent "$runtime_dir/hypr-profiles/profile-overlay.mode"
assert_file_equals "$runtime_dir/hypr-profiles/gaming.watchdog.count" "1"
run_profilectl clear-manual
assert_file_equals "$runtime_dir/hypr-profiles/profile-overlay.mode" "gaming"
run_profilectl set-manual powersave
assert_file_equals "$runtime_dir/hypr-profiles/profile-overlay.mode" "powersave"
run_profilectl clear-manual
assert_file_equals "$runtime_dir/hypr-profiles/profile-overlay.mode" "gaming"
run_profilectl set-manual gaming
run_profilectl sync gaming 0
assert_file_equals "$runtime_dir/hypr-profiles/profile-overlay.mode" "gaming"
run_profilectl clear-manual
assert_absent "$runtime_dir/hypr-profiles/profile-overlay.mode"

reset_profile_state
run_profilectl set-manual gaming
assert_file_equals "$runtime_dir/hypr-profiles/gaming.manual.count" "1"
assert_file_equals "$runtime_dir/hypr-profiles/profile-overlay.mode" "gaming"

if HYPRCTL_FAIL_DEFAULT=1 run_profilectl clear-manual; then
  fail "profilectl succeeded after the default profile failed to apply"
fi

assert_file_equals "$runtime_dir/hypr-profiles/gaming.manual.count" "1"
assert_file_equals "$runtime_dir/hypr-profiles/profile-overlay.mode" "gaming"
assert_file_equals "$runtime_dir/hypr-profiles/profile-overlay.active" ""

reset_profile_state
mkdir -p "$runtime_dir/hypr-profiles/profile-overlay.mode"

if run_profilectl apply gaming >/dev/null 2>&1; then
  fail "profilectl succeeded after mode state publication failed"
fi

assert_file_equals "$runtime_dir/hypr-profiles/gaming.manual.count" "0"
assert_file_equals "$runtime_dir/hypr-profiles/profile-overlay.active" ""
rm -rf "$runtime_dir/hypr-profiles/profile-overlay.mode"
run_profilectl reconcile
[[ ! -e "$runtime_dir/hypr-profiles/profile-overlay.active" ]] || fail "profilectl retained recovery state after mode publication recovery"

reset_profile_state
run_profilectl set-manual gaming
rm -f "$runtime_dir/hypr-profiles/powersave.manual.count"
mkdir "$runtime_dir/hypr-profiles/powersave.manual.count"

if run_profilectl set-manual powersave >/dev/null 2>&1; then
  fail "profilectl succeeded after manual selection state publication failed"
fi

assert_file_equals "$runtime_dir/hypr-profiles/gaming.manual.count" "1"
assert_file_equals "$runtime_dir/hypr-profiles/profile-overlay.mode" "gaming"

reset_profile_state

if HYPRCTL_FAIL_GAMING=1 HYPRCTL_FAIL_DEFAULT=1 run_profilectl apply gaming >/dev/null 2>&1; then
  fail "profilectl succeeded after Gaming activation and rollback both failed"
fi

assert_file_equals "$runtime_dir/hypr-profiles/gaming.manual.count" "0"
assert_file_equals "$runtime_dir/hypr-profiles/profile-overlay.active" ""

if HYPRCTL_FAIL_DEFAULT=1 run_profilectl reconcile >/dev/null 2>&1; then
  fail "profilectl reconciled a failed rollback without restoring defaults"
fi

assert_file_equals "$runtime_dir/hypr-profiles/profile-overlay.active" ""
run_profilectl reconcile
[[ ! -e "$runtime_dir/hypr-profiles/profile-overlay.active" ]] || fail "profilectl retained recovery state after a successful reconcile"

reset_profile_state
write_raw_state_fixture '{"version":'
assert_file_equals "$runtime_dir/hypr-profiles/state.json" '{"version":'

write_raw_state_fixture '{"generation":1}'
rename_ready="$seam_dir/rename-ready"
rename_release="$seam_dir/rename-release"
state_temporary="$(mktemp "$runtime_dir/hypr-profiles/.state.XXXXXX")"
printf '%s' '{"generation":2}' > "$state_temporary"

XDG_RUNTIME_DIR="$runtime_dir" \
  PROFILECTL_TEST_REAL_MV="$real_mv" \
  PROFILECTL_TEST_HOLD_STATE_RENAME=1 \
  PROFILECTL_TEST_RENAME_READY_FILE="$rename_ready" \
  PROFILECTL_TEST_RENAME_RELEASE_FILE="$rename_release" \
  "$bin_dir/mv" -f "$state_temporary" "$runtime_dir/hypr-profiles/state.json" &
rename_pid=$!
wait_for_file "$rename_ready"
assert_file_equals "$runtime_dir/hypr-profiles/state.json" '{"generation":1}'
touch "$rename_release"
wait "$rename_pid"
assert_file_equals "$runtime_dir/hypr-profiles/state.json" '{"generation":2}'

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
assert_absent "$runtime_dir/hypr-profiles/profile-overlay.mode"

reset_profile_state
: > "$actuator_log"
export PROFILECTL_TEST_HYPRCTL_INTERRUPT_PHASE=after-actuation
start_profilectl apply gaming
if wait "$profilectl_pid"; then
  fail "controller survived interruption after actuation"
fi
assert_file_contains "$actuator_log" 'hyprctl applied gaming'
assert_absent "$runtime_dir/hypr-profiles/profile-overlay.mode"
unset PROFILECTL_TEST_HYPRCTL_INTERRUPT_TARGET PROFILECTL_TEST_HYPRCTL_INTERRUPT_PHASE

printf 'PASS profilectl fixture preserves legacy behavior and exposes canonical-state transition seams\n'

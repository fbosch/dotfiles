#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
profilectl="$repo_root/runtime/profiles/profilectl.sh"
test_dir="$(mktemp -d)"
bin_dir="$test_dir/bin"
home_dir="$test_dir/home"
runtime_dir="$test_dir/runtime"
actuator_log="$test_dir/actuator.log"

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

write_stub() {
  local name="$1"

  # shellcheck disable=SC2016
  printf '%s\n' '#!/bin/sh' 'printf "%s %s\n" "${0##*/}" "$*" >> "$ACTUATOR_LOG"' 'exit 0' > "$bin_dir/$name"
  chmod +x "$bin_dir/$name"
}

mkdir -p "$bin_dir" "$home_dir/.config/hypr/runtime/profiles" "$runtime_dir"
ln -s "$profilectl" "$home_dir/.config/hypr/runtime/profiles/profilectl.sh"
write_stub ags
write_stub pkill
write_stub powerprofilesctl

cat > "$bin_dir/hyprctl" <<'EOF'
#!/bin/sh
printf '%s %s\n' "${0##*/}" "$*" >> "$ACTUATOR_LOG"
if [ "${HYPRCTL_FAIL_DEFAULT:-0}" = 1 ] && [ "$1" = eval ] && [ "$2" = 'require("profiles").apply("default")' ]; then
  exit 1
fi
EOF
chmod +x "$bin_dir/hyprctl"

run_profilectl() {
  HOME="$home_dir" \
    PATH="$bin_dir:$PATH" \
    XDG_RUNTIME_DIR="$runtime_dir" \
    ACTUATOR_LOG="$actuator_log" \
    "$profilectl" "$@"
}

run_profilectl set-manual gaming
assert_file_equals "$runtime_dir/hypr-profiles/gaming.manual.count" "1"
assert_file_equals "$runtime_dir/hypr-profiles/profile-overlay.mode" "gaming"

if HYPRCTL_FAIL_DEFAULT=1 run_profilectl clear-manual; then
  fail "profilectl succeeded after the default profile failed to apply"
fi

assert_file_equals "$runtime_dir/hypr-profiles/gaming.manual.count" "1"
assert_file_equals "$runtime_dir/hypr-profiles/profile-overlay.mode" "gaming"
assert_file_equals "$runtime_dir/hypr-profiles/profile-overlay.active" ""

rm -rf "$runtime_dir/hypr-profiles"
mkdir -p "$runtime_dir/hypr-profiles/profile-overlay.mode"

if run_profilectl apply gaming >/dev/null 2>&1; then
  fail "profilectl succeeded after mode state publication failed"
fi

assert_file_equals "$runtime_dir/hypr-profiles/gaming.manual.count" "0"
[[ ! -e "$runtime_dir/hypr-profiles/profile-overlay.active" ]] || fail "profilectl published an active overlay after mode state publication failed"

rm -rf "$runtime_dir/hypr-profiles"
run_profilectl set-manual gaming
rm -f "$runtime_dir/hypr-profiles/powersave.manual.count"
mkdir "$runtime_dir/hypr-profiles/powersave.manual.count"

if run_profilectl set-manual powersave >/dev/null 2>&1; then
  fail "profilectl succeeded after manual selection state publication failed"
fi

assert_file_equals "$runtime_dir/hypr-profiles/gaming.manual.count" "1"
assert_file_equals "$runtime_dir/hypr-profiles/profile-overlay.mode" "gaming"

printf 'PASS profilectl preserves state through restore, publication, and selection failures\n'

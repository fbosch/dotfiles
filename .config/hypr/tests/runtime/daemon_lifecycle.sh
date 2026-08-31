#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT

# shellcheck disable=SC2034
daemon_lifecycle_name="fixture"
daemon_lifecycle_file="$test_dir/fixture.lifecycle"
# shellcheck disable=SC1091
. "$repo_root/runtime/lib/daemon-lifecycle.sh"

assert_field() {
  local field="$1" expected="$2"
  local actual
  actual="$(sed -n "s/^${field}=//p" "$daemon_lifecycle_file")"
  [[ "$actual" == "$expected" ]] || {
    printf 'expected %s=%s, got %s\n' "$field" "$expected" "$actual" >&2
    exit 1
  }
}

daemon_lifecycle_record_running 123
assert_field version 1
assert_field name fixture
assert_field state running
assert_field owner_pid "$$"
assert_field child_pid 123
assert_field reason started
assert_field detail ""
assert_field status ""
[[ "$(stat -c %a "$daemon_lifecycle_file")" == 600 ]]

daemon_lifecycle_record_exit signal 0 123 TERM
assert_field state exited
assert_field reason signal
assert_field detail TERM
assert_field status 0

daemon_lifecycle_record_exit child-exit 7 456 2> "$test_dir/error"
assert_field child_pid 456
assert_field reason child-exit
assert_field status 7
grep -Fq 'fixture: child 456 exited with status 7' "$test_dir/error"

if compgen -G "$test_dir/*.tmp" >/dev/null; then
  printf 'daemon lifecycle left temporary files behind\n' >&2
  exit 1
fi

printf 'PASS daemon lifecycle publishes atomic diagnostic state\n'

#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
test_dir="$(mktemp -d)"
runtime_dir="$test_dir/runtime"
bin_dir="$test_dir/bin"

cleanup() {
  rm -rf "$test_dir"
}
trap cleanup EXIT

mkdir -p "$bin_dir"
for executable in bash awk date dirname flock id mkdir mktemp nc; do
  executable_path="$(command -v "$executable")"
  ln -s "$executable_path" "$bin_dir/$executable"
done

mkdir -p "$runtime_dir"
if output="$(PATH="$bin_dir" XDG_RUNTIME_DIR="$runtime_dir" HYPRLAND_INSTANCE_SIGNATURE=fixture "$repo_root/runtime/desktop/night-light.sh" status 2>&1)"; then
  printf 'night-light unexpectedly ran without hyprsunset\n' >&2
  exit 1
fi

case "$output" in
  *'night-light: disabled: missing hyprsunset'*) ;;
  *)
    printf 'unexpected missing-dependency output: %s\n' "$output" >&2
    exit 1
    ;;
esac
test ! -e "$runtime_dir/hypr-night-light/hyprsunset-owner"

printf 'PASS night-light disables locally without hyprsunset\n'

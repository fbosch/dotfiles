#!/usr/bin/env bash

set -euo pipefail

style_file="${1:-$PWD/.config/waybar/style.css}"
waybar_bin="${WAYBAR_BIN:-waybar}"
config_file="$(mktemp)"
log_file="$(mktemp)"

# shellcheck disable=SC2329
cleanup() {
  rm -f "$config_file" "$log_file"
}
trap cleanup EXIT

if [[ ! -f "$style_file" ]]; then
  printf 'Waybar stylesheet not found: %s\n' "$style_file" >&2
  exit 1
fi

if [[ -z "${WAYLAND_DISPLAY:-}" ]]; then
  printf 'Waybar CSS validation requires an active Wayland session\n' >&2
  exit 1
fi

# Parse the stylesheet without creating a layer surface on a real output.
printf '%s\n' '{"output":"waybar-css-validation","layer":"top","position":"bottom"}' > "$config_file"

set +e
timeout --kill-after=1s 3s "$waybar_bin" \
  --config "$config_file" \
  --style "$style_file" \
  --log-level error > "$log_file" 2>&1
status=$?
set -e

if [[ "$status" -eq 124 ]]; then
  printf 'Waybar CSS is valid: %s\n' "$style_file"
  exit 0
fi

printf 'Waybar CSS validation failed: %s\n' "$style_file" >&2
cat "$log_file" >&2
exit "$status"

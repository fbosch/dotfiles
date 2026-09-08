#!/usr/bin/env dash
set -eu

case "$#:${1:-}" in
  1:show|1:hide|1:prewarm|1:hold|1:release) intent="$1" ;;
  *)
    printf 'usage: %s {show|hide|prewarm|hold|release}\n' "${0##*/}" >&2
    exit 2
    ;;
esac

hypr_ipc="${HOME:-}/.config/hypr/runtime/lib/hypr-ipc.sh"
if [ -z "${HOME:-}" ] || [ ! -r "$hypr_ipc" ]; then
  printf 'waybar-control: unavailable\n' >&2
  exit 1
fi

# shellcheck disable=SC1090
. "$hypr_ipc"

socket_path="$(hypr_instance_socket_path waybar-monitor.sock 2>/dev/null || true)"
if [ -z "$socket_path" ]; then
  printf 'waybar-control: unavailable\n' >&2
  exit 1
fi

separator="$(printf '\037')"
result="$(
  set +e
  printf '%s\n' "$intent" | timeout --foreground 1s nc -w 1 -U "$socket_path" 2>/dev/null
  status=$?
  printf '%s%s' "$separator" "$status"
)"
status="${result##*"$separator"}"
if [ "$status" != 0 ]; then
  printf 'waybar-control: unavailable\n' >&2
  exit 1
fi

expected="ok
${separator}0"
if [ "$result" != "$expected" ]; then
  printf 'waybar-control: rejected\n' >&2
  exit 1
fi

exit 0

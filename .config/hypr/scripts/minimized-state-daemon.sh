#!/usr/bin/env bash

set -euo pipefail

readonly STATE_FILE="${XDG_RUNTIME_DIR}/hypr-minimized-state.json"
readonly RECONNECT_DELAY_SECONDS=1

if command -v hyprctl >/dev/null 2>&1; then
  :
else
  exit 1
fi

if command -v jq >/dev/null 2>&1; then
  :
else
  exit 1
fi

if command -v socat >/dev/null 2>&1; then
  :
else
  exit 1
fi

if [[ -n "${HYPRLAND_INSTANCE_SIGNATURE:-}" ]]; then
  :
else
  exit 1
fi

readonly HYPR_SOCKET="$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock"
if [[ -S "$HYPR_SOCKET" ]]; then
  :
else
  exit 1
fi

init_state_file() {
  if [[ -f "$STATE_FILE" ]]; then
    if jq -e 'type == "object"' "$STATE_FILE" >/dev/null 2>&1; then
      return
    fi
  fi

  printf '{}\n' > "$STATE_FILE"
}

remove_address_entry() {
  local address="$1"
  local temp_file

  temp_file="$(mktemp)"
  jq --arg address "$address" 'del(.[$address])' "$STATE_FILE" > "$temp_file"
  mv "$temp_file" "$STATE_FILE"
}

prune_state_file() {
  local temp_file

  temp_file="$(mktemp)"
  hyprctl clients -j 2>/dev/null | jq --slurpfile saved "$STATE_FILE" '
    (.[].address) as $addresses
    | ($addresses | INDEX(.)) as $live
    | ($saved[0] // {})
    | with_entries(select($live[.key] != null))
  ' > "$temp_file"
  mv "$temp_file" "$STATE_FILE"
}

handle_event() {
  local event="$1"
  local address

  case "$event" in
    closewindow* )
      address="${event#*>>}"
      address="${address%%,*}"
      if [[ -n "$address" ]]; then
        remove_address_entry "$address"
      fi
      ;;
  esac
}

init_state_file
prune_state_file

while true; do
  init_state_file

  while IFS= read -r line; do
    handle_event "$line"
  done < <(socat -U - "UNIX-CONNECT:$HYPR_SOCKET")

  sleep "$RECONNECT_DELAY_SECONDS"
done

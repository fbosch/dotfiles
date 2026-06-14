#!/usr/bin/env bash

set -euo pipefail

# shellcheck disable=SC1091
source "${HOME}/.config/hypr/runtime/lib/hypr-ipc.sh"

PROFILECTL="$HOME/.config/hypr/runtime/profiles/profilectl.sh"
TASKBAR_APP_SCRIPT="$HOME/.config/hypr/taskbar/actions.sh"
SCRIPT_PATH="$HOME/.config/hypr/runtime/windows/killactive-selective.sh"
AGS_START_SCRIPT="$HOME/.config/ags/start-daemons.sh"

readonly ACTION_KILL="kill"
readonly ACTION_CONFIRM="confirm"

dispatch_close_window_address() {
  local address="$1"

  if [[ "$address" =~ ^0x[0-9a-fA-F]+$ ]]; then
    hypr_dispatch_lua "hl.dsp.window.close({ window = \"address:$address\" })"
  else
    notify_close_action "Close failed" "Invalid window address: $address"
    return 1
  fi
}

dispatch_killactive() {
  hypr_dispatch_lua 'hl.dsp.window.close()'
}

notify_close_action() {
  local summary="$1"
  local body="$2"

  if command -v notify-send >/dev/null 2>&1; then
    notify-send -a Hyprland "$summary" "$body"
  fi
}

is_gaming_protected_window() {
  local app_class="$1"

  [[ "$app_class" =~ ^(gamescope|steam_app_.*)$ ]]
}

rule_confirm_gaming_protected_window() {
  local app_class="$1"

  if "$PROFILECTL" is-active gaming && is_gaming_protected_window "$app_class"; then
    printf '%s\n' "$ACTION_CONFIRM"
    return 0
  fi

  return 1
}

resolve_close_action() {
  local app_class="$1"

  if action="$(rule_confirm_gaming_protected_window "$app_class")"; then
    printf '%s\n' "$action"
    return
  fi

  printf '%s\n' "$ACTION_KILL"
}

run_close_action() {
  local action="$1"
  local title="$2"
  local address="$3"

  if [[ "$action" == "$ACTION_CONFIRM" ]]; then
    request_confirm_close "$title" "$address"
    exit 0
  fi

  dispatch_killactive
}

request_confirm_close() {
  local title="$1"
  local address="$2"
  local display_title="${title:-game window}"
  local payload

  if [[ ! "$address" =~ ^0x[0-9a-fA-F]+$ ]]; then
    notify_close_action "Close blocked" "Could not confirm protected window without a stable address"
    return 1
  fi

  payload="$(jq -nc \
    --arg message "Close protected game window: $display_title?" \
    --arg command "$SCRIPT_PATH --confirmed-address $address" \
    '{
      action: "show",
      config: {
        icon: "!",
        title: "Close game window",
        message: $message,
        confirmLabel: "Close",
        cancelLabel: "Cancel",
        confirmCommand: $command,
        variant: "warning"
      }
    }')"

  if ! show_confirm_dialog "$payload"; then
    notify_close_action "Close blocked" "Could not show confirmation dialog for: $display_title"
    return 1
  fi
}

show_confirm_dialog() {
  local payload="$1"
  local response

  response="$(ags request -i ags-bundled confirm-dialog "$payload" 2>/dev/null || true)"
  if [[ "$response" == "shown" ]]; then
    return 0
  fi

  if [[ -x "$AGS_START_SCRIPT" ]]; then
    "$AGS_START_SCRIPT" >/dev/null 2>&1 || true
    response="$(ags request -i ags-bundled confirm-dialog "$payload" 2>/dev/null || true)"
    [[ "$response" == "shown" ]]
    return
  fi

  return 1
}

if [[ "${1:-}" == "--confirmed-address" ]]; then
  dispatch_close_window_address "${2:-}"
  exit $?
fi

active_window_json="$(hypr_query 'j/activewindow' || printf '{}')"
app_class="$(jq -r 'if (.class // "") != "" then .class else (.initialClass // "") end' <<< "$active_window_json")"
title="$(jq -r '.title // ""' <<< "$active_window_json")"
address="$(jq -r '.address // ""' <<< "$active_window_json")"

if "$TASKBAR_APP_SCRIPT" --park-active; then
  exit 0
fi

action="$(resolve_close_action "$app_class")"

run_close_action "$action" "$title" "$address"

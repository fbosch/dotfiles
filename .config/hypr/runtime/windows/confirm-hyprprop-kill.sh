#!/usr/bin/env bash

set -euo pipefail

if command -v hyprprop >/dev/null 2>&1; then
  :
else
  if command -v notify-send >/dev/null 2>&1; then
    notify-send -a Hyprland "hyprprop kill" "hyprprop not found"
  fi
  exit 1
fi

window_json="$(hyprprop --raw 2>/dev/null || true)"
if [[ -z "$window_json" ]]; then
  exit 1
fi

pid="$(jq -r '.pid // empty' <<<"$window_json" 2>/dev/null)"

if [[ "$pid" =~ ^[0-9]+$ ]] && [[ "$pid" -gt 0 ]]; then
  :
else
  if command -v notify-send >/dev/null 2>&1; then
    notify-send -a Hyprland "hyprprop kill" "Could not determine PID"
  fi
  exit 1
fi

payload="$(jq -nc \
  --arg message "Kill selected process [PID: $pid]?" \
  --argjson pid "$pid" \
  '{
    action: "show",
    config: {
      icon: "󱂥",
      title: "Force close window",
      message: $message,
      confirmLabel: "Kill",
      cancelLabel: "Cancel",
      operation: { type: "kill-process", pid: $pid },
      variant: "danger"
    }
  }')"

ags request -i ags-bundled confirm-dialog "$payload"

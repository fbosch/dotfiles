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
title="$(jq -r '.title // ""' <<<"$window_json" 2>/dev/null)"
class="$(jq -r '.class // .initialClass // "Unknown"' <<<"$window_json" 2>/dev/null)"

if [[ "$pid" =~ ^[0-9]+$ ]] && [[ "$pid" -gt 0 ]]; then
  :
else
  if command -v notify-send >/dev/null 2>&1; then
    notify-send -a Hyprland "hyprprop kill" "Could not determine PID"
  fi
  exit 1
fi

display_name="$class"
if [[ -n "$title" ]]; then
  display_name="$class ($title)"
fi

payload="$(jq -nc \
  --arg message "Kill process: $display_name [PID: $pid]?" \
  --arg command "bash ~/.config/hypr/scripts/kill-pid-with-fallback.sh $pid" \
  '{
    action: "show",
    config: {
      icon: "󱂥",
      title: "Force close window",
      message: $message,
      confirmLabel: "Kill",
      cancelLabel: "Cancel",
      confirmCommand: $command,
      variant: "danger"
    }
  }')"

ags request -i ags-bundled confirm-dialog "$payload"

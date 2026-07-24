#!/bin/sh

set -eu

herdr="${HERDR_BIN_PATH:-herdr}"

format_window() {
  usage_percent="$1"
  resets_at="$2"
  remaining=$((100 - usage_percent))

  if [ "$remaining" -lt 0 ]; then
    remaining=0
  fi

  if [ -n "$resets_at" ]; then
    reset_epoch=$(date -d "$resets_at" +%s 2>/dev/null || true)
    now_epoch=$(date +%s)
    if [ -n "$reset_epoch" ] && [ "$reset_epoch" -gt "$now_epoch" ]; then
      remaining_seconds=$((reset_epoch - now_epoch))
      if [ "$remaining_seconds" -lt 3600 ]; then
        reset_label="$(((remaining_seconds + 59) / 60))m"
      elif [ "$remaining_seconds" -lt 86400 ]; then
        reset_label="$(((remaining_seconds + 3599) / 3600))h"
      else
        reset_label="$(((remaining_seconds + 86399) / 86400))d"
      fi
      printf '%s%% %s' "$remaining" "$reset_label"
      return
    fi
  fi

  printf '%s%%' "$remaining"
}

usage=$(codexbar usage --source oauth --provider codex --json 2>/dev/null || true)
[ -n "$usage" ] || exit 0

primary=$(printf '%s' "$usage" | jq -r '[(.[] | .usage.primary | select(. != null) | "\((.usedPercent // 0) | floor)\t\(.resetsAt // "")")][0] // empty')
secondary=$(printf '%s' "$usage" | jq -r '[(.[] | .usage.secondary | select(. != null) | "\((.usedPercent // 0) | floor)\t\(.resetsAt // "")")][0] // empty')

label=""
if [ -n "$primary" ]; then
	read -r primary_used primary_reset <<EOF
$primary
EOF
  label=$(format_window "$primary_used" "$primary_reset")
fi
if [ -n "$secondary" ]; then
	read -r secondary_used secondary_reset <<EOF
$secondary
EOF
  secondary_label=$(format_window "$secondary_used" "$secondary_reset")
  label="${label:+$label · }$secondary_label"
fi
[ -n "$label" ] || exit 0

"$herdr" pane list | jq -r '.result.panes[] | select(.agent == "codex" or .agent == "opencode") | .pane_id' |
while IFS= read -r pane_id; do
  "$herdr" pane report-metadata "$pane_id" \
    --source "plugin:fbb.chatgpt-usage" \
    --token "chatgpt_usage=GPT $label" \
    --ttl-ms 900000 >/dev/null
done

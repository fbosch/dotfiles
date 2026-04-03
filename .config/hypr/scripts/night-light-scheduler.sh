#!/usr/bin/env bash

set -euo pipefail

START_HOUR=21
END_HOUR=7
CHECK_INTERVAL_SECONDS=60
TEMPERATURE=4000

night_light_is_enabled() {
  pgrep -x hyprsunset >/dev/null
}

ensure_night_light_on() {
  if night_light_is_enabled; then
    return 0
  fi

  pkill -9 hyprsunset 2>/dev/null || true
  hyprsunset -t "$TEMPERATURE" >/dev/null 2>&1 &
}

ensure_night_light_off() {
  if night_light_is_enabled; then
    pkill -9 hyprsunset 2>/dev/null || true
  fi
}

night_light_should_be_enabled() {
  local current_hour
  current_hour=$(date +%H)
  current_hour=$((10#$current_hour))

  if (( START_HOUR < END_HOUR )); then
    (( current_hour >= START_HOUR && current_hour < END_HOUR ))
    return
  fi

  (( current_hour >= START_HOUR || current_hour < END_HOUR ))
}

main() {
  while true; do
    if night_light_should_be_enabled; then
      ensure_night_light_on
    else
      ensure_night_light_off
    fi

    sleep "$CHECK_INTERVAL_SECONDS"
  done
}

main

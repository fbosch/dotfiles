#!/usr/bin/env bash

set -euo pipefail

STATE_DIR="${XDG_RUNTIME_DIR:-/tmp}/hypr-night-light"
OVERRIDE_FILE="$STATE_DIR/override"
PID_FILE="$STATE_DIR/daemon.pid"

DAY_TEMP=6500
NIGHT_TEMP=4000
SUNRISE="06:30"
SUNSET="18:30"
AUTO_SCHEDULE=true
ENABLED=false

mkdir -p "$STATE_DIR"

time_to_minutes() {
  local value="$1"
  local hour="${value%%:*}"
  local minute="${value##*:}"

  printf "%d" $((10#$hour * 60 + 10#$minute))
}

current_minutes() {
  local now
  now="$(date +%H:%M)"
  time_to_minutes "$now"
}

scheduled_active() {
  local sunrise sunset now
  sunrise="$(time_to_minutes "$SUNRISE")"
  sunset="$(time_to_minutes "$SUNSET")"
  now="$(current_minutes)"

  if [[ "$sunset" -gt "$sunrise" ]]; then
    [[ "$now" -ge "$sunset" || "$now" -lt "$sunrise" ]]
    return
  fi

  [[ "$now" -ge "$sunset" && "$now" -lt "$sunrise" ]]
}

desired_active() {
  local override

  if [[ -f "$OVERRIDE_FILE" ]]; then
    override="$(< "$OVERRIDE_FILE")"
    [[ "$override" == "on" ]]
    return
  fi

  if [[ "$AUTO_SCHEDULE" != "true" ]]; then
    [[ "$ENABLED" == "true" ]]
    return
  fi

  scheduled_active
}

is_active() {
  pgrep -x hyprsunset >/dev/null
}

set_temperature() {
  local temperature="$1"

  pkill -x hyprsunset 2>/dev/null || true
  if [[ "$temperature" -lt "$DEFAULT_DAY_TEMP" ]]; then
    hyprsunset -t "$temperature" >/dev/null 2>&1 &
  fi
}

apply_state() {
  if desired_active; then
    set_temperature "$NIGHT_TEMP"
    return
  fi

  set_temperature "$DAY_TEMP"
}

notify_state() {
  local active="$1"
  local icon title body color glyph

  if [[ "$active" == "true" ]]; then
    glyph="󰖔"
    color="#e67e22"
    title="Night Light Enabled"
    body="Color temperature set to ${NIGHT_TEMP}K"
  else
    glyph="󰖨"
    color="#dea721"
    title="Night Light Disabled"
    body="Color temperature restored to normal"
  fi

  icon="$($HOME/.config/hypr/runtime/desktop/nerd-icon-gen.sh "$glyph" 64 "$color" 2>/dev/null || printf "")"
  if [[ -n "$icon" && -f "$icon" ]]; then
    notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:night-light "$title" "$body" -i "$icon"
    return
  fi

  notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:night-light "$title" "$body"
}

next_boundary_epoch() {
  local candidate next sunrise sunset now today_sunrise today_sunset tomorrow_sunrise tomorrow_sunset
  sunrise="$SUNRISE"
  sunset="$SUNSET"
  now="$(date +%s)"
  today_sunrise="$(date -d "today $sunrise" +%s)"
  today_sunset="$(date -d "today $sunset" +%s)"
  tomorrow_sunrise="$(date -d "tomorrow $sunrise" +%s)"
  tomorrow_sunset="$(date -d "tomorrow $sunset" +%s)"

  next="$tomorrow_sunrise"
  for candidate in "$today_sunrise" "$today_sunset" "$tomorrow_sunrise" "$tomorrow_sunset"; do
    if [[ "$candidate" -gt "$now" && "$candidate" -lt "$next" ]]; then
      next="$candidate"
    fi
  done

  printf "%s" "$next"
}

run_daemon() {
  local sleep_for boundary now

  if [[ -f "$PID_FILE" ]] && kill -0 "$(< "$PID_FILE")" 2>/dev/null; then
    exit 0
  fi

  printf "%s" "$$" > "$PID_FILE"
  trap 'rm -f "$PID_FILE"' EXIT

  while true; do
    rm -f "$OVERRIDE_FILE"
    apply_state

    boundary="$(next_boundary_epoch)"
    now="$(date +%s)"
    sleep_for=$((boundary - now + 1))
    if [[ "$sleep_for" -lt 60 ]]; then
      sleep_for=60
    fi

    sleep "$sleep_for"
  done
}

toggle() {
  if is_active; then
    printf "off" > "$OVERRIDE_FILE"
    apply_state
    notify_state false
    printf "Night light disabled\n"
    return
  fi

  printf "on" > "$OVERRIDE_FILE"
  apply_state
  notify_state true
  printf "Night light enabled\n"
}

case "${1:-toggle}" in
  daemon)
    run_daemon
    ;;
  sync)
    apply_state
    ;;
  toggle)
    toggle
    ;;
  is-active)
    is_active
    ;;
  status)
    if is_active; then
      printf "active\n"
    else
      printf "inactive\n"
    fi
    ;;
  *)
    printf "usage: %s [daemon|sync|toggle|is-active|status]\n" "$0" >&2
    exit 1
    ;;
esac

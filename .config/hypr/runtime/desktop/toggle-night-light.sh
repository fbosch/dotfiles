#!/usr/bin/env bash

set -euo pipefail

CONFIG_FILE="$HOME/.config/noctalia/settings.json"
STATE_DIR="${XDG_RUNTIME_DIR:-/tmp}/hypr-night-light"
OVERRIDE_FILE="$STATE_DIR/override"
PID_FILE="$STATE_DIR/daemon.pid"

DEFAULT_DAY_TEMP=6500
DEFAULT_NIGHT_TEMP=4000
DEFAULT_SUNRISE="06:30"
DEFAULT_SUNSET="18:30"

mkdir -p "$STATE_DIR"

json_value() {
  local key="$1"
  local fallback="$2"

  if [[ ! -f "$CONFIG_FILE" ]]; then
    printf "%s" "$fallback"
    return
  fi

  if command -v jq >/dev/null 2>&1; then
    jq -er ".nightLight.$key // empty" "$CONFIG_FILE" 2>/dev/null || printf "%s" "$fallback"
    return
  fi

  sed -n "/\"nightLight\"[[:space:]]*:/,/^[[:space:]]*}/s/.*\"$key\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^\",}]*\)\"\{0,1\}.*/\1/p" "$CONFIG_FILE"
}

setting() {
  local value
  value="$(json_value "$1" "$2")"
  printf "%s" "${value:-$2}"
}

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
  sunrise="$(time_to_minutes "$(setting manualSunrise "$DEFAULT_SUNRISE")")"
  sunset="$(time_to_minutes "$(setting manualSunset "$DEFAULT_SUNSET")")"
  now="$(current_minutes)"

  if [[ "$sunset" -gt "$sunrise" ]]; then
    [[ "$now" -ge "$sunset" || "$now" -lt "$sunrise" ]]
    return
  fi

  [[ "$now" -ge "$sunset" && "$now" -lt "$sunrise" ]]
}

desired_active() {
  local auto_schedule forced enabled override

  if [[ -f "$OVERRIDE_FILE" ]]; then
    override="$(< "$OVERRIDE_FILE")"
    [[ "$override" == "on" ]]
    return
  fi

  auto_schedule="$(setting autoSchedule true)"
  forced="$(setting forced false)"
  enabled="$(setting enabled false)"

  if [[ "$forced" == "true" || "$auto_schedule" != "true" ]]; then
    [[ "$enabled" == "true" ]]
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
    set_temperature "$(setting nightTemp "$DEFAULT_NIGHT_TEMP")"
    return
  fi

  set_temperature "$(setting dayTemp "$DEFAULT_DAY_TEMP")"
}

notify_state() {
  local active="$1"
  local icon title body color glyph

  if [[ "$active" == "true" ]]; then
    glyph="󰖔"
    color="#e67e22"
    title="Night Light Enabled"
    body="Color temperature set to $(setting nightTemp "$DEFAULT_NIGHT_TEMP")K"
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
  sunrise="$(setting manualSunrise "$DEFAULT_SUNRISE")"
  sunset="$(setting manualSunset "$DEFAULT_SUNSET")"
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

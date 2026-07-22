#!/usr/bin/env bash

set -euo pipefail

STATE_DIR="${XDG_RUNTIME_DIR:-/tmp}/hypr-night-light"
OVERRIDE_FILE="$STATE_DIR/override"
OVERRIDE_EXPIRY_FILE="$STATE_DIR/override-expiry"
PID_FILE="$STATE_DIR/daemon.pid"
TEMPERATURE_FILE="$STATE_DIR/temperature"

DAY_TEMP=6500
NIGHT_TEMP=4000
TRANSITION_SECONDS=3600
UPDATE_INTERVAL=300
LATITUDE=55.6761
LONGITUDE=12.5683
AUTO_SCHEDULE=true
ENABLED=false

mkdir -p "$STATE_DIR"

solar_event_epoch() {
  local date="$1"
  local event="$2"
  local day_of_year utc_midnight utc_seconds

  day_of_year="$(date -d "$date" +%j)"
  utc_midnight="$(date -u -d "$date 00:00:00" +%s)"
  # Calculate the local solar event from the date and fixed Copenhagen coordinates.
  utc_seconds="$(awk -v day="$day_of_year" -v latitude="$LATITUDE" -v longitude="$LONGITUDE" -v event="$event" '
    function radians(degrees) { return degrees * atan2(0, -1) / 180 }
    function degrees(radians) { return radians * 180 / atan2(0, -1) }
    function normalize(value) { value %= 360; return value < 0 ? value + 360 : value }
    function arcsine(value) { return atan2(value, sqrt(1 - value * value)) }
    function arccosine(value) { return atan2(sqrt(1 - value * value), value) }
    BEGIN {
      approximate_time = day + ((event == "sunrise" ? 6 : 18) - longitude / 15) / 24
      mean_anomaly = 0.9856 * approximate_time - 3.289
      true_longitude = normalize(mean_anomaly + 1.916 * sin(radians(mean_anomaly)) + 0.020 * sin(radians(2 * mean_anomaly)) + 282.634)
      right_ascension = normalize(degrees(atan2(0.91764 * sin(radians(true_longitude)), cos(radians(true_longitude)))))
      right_ascension += int(true_longitude / 90) * 90 - int(right_ascension / 90) * 90
      right_ascension /= 15
      sin_declination = 0.39782 * sin(radians(true_longitude))
      cos_declination = cos(arcsine(sin_declination))
      cos_hour_angle = (cos(radians(90.833)) - sin_declination * sin(radians(latitude))) / (cos_declination * cos(radians(latitude)))
      if (cos_hour_angle < -1 || cos_hour_angle > 1) exit 1
      hour_angle = degrees(arccosine(cos_hour_angle))
      if (event == "sunrise") hour_angle = 360 - hour_angle
      universal_time = (hour_angle / 15 + right_ascension - 0.06571 * approximate_time - 6.622 - longitude / 15) % 24
      if (universal_time < 0) universal_time += 24
      printf "%.0f", universal_time * 3600
    }
  ')" || return 1

  printf "%s" "$((utc_midnight + utc_seconds))"
}

scheduled_temperature() {
  local today now sunrise sunset
  today="$(date +%F)"
  now="$(date +%s)"
  sunrise="$(solar_event_epoch "$today" sunrise)"
  sunset="$(solar_event_epoch "$today" sunset)"

  awk -v now="$now" -v sunrise="$sunrise" -v sunset="$sunset" \
    -v day_temp="$DAY_TEMP" -v night_temp="$NIGHT_TEMP" \
    -v transition="$TRANSITION_SECONDS" '
      function interpolate(start, end, progress) {
        return int(start + (end - start) * progress + 0.5)
      }
      BEGIN {
        if (now < sunrise - transition || now >= sunset + transition) {
          print night_temp
        } else if (now < sunrise + transition) {
          print interpolate(night_temp, day_temp, (now - (sunrise - transition)) / (2 * transition))
        } else if (now < sunset - transition) {
          print day_temp
        } else {
          print interpolate(day_temp, night_temp, (now - (sunset - transition)) / (2 * transition))
        }
      }
    '
}

desired_temperature() {
  local override

  if [[ -f "$OVERRIDE_FILE" ]]; then
    override="$(< "$OVERRIDE_FILE")"
    if [[ "$override" == "on" ]]; then
      printf "%s" "$NIGHT_TEMP"
    else
      printf "%s" "$DAY_TEMP"
    fi
    return
  fi

  if [[ "$AUTO_SCHEDULE" != "true" ]]; then
    if [[ "$ENABLED" == "true" ]]; then
      printf "%s" "$NIGHT_TEMP"
    else
      printf "%s" "$DAY_TEMP"
    fi
    return
  fi

  scheduled_temperature
}

is_active() {
  pgrep -x hyprsunset >/dev/null
}

set_temperature() {
  local temperature="$1" previous_temperature=""

  if [[ -f "$TEMPERATURE_FILE" ]]; then
    previous_temperature="$(< "$TEMPERATURE_FILE")"
  fi

  if [[ "$temperature" == "$previous_temperature" ]]; then
    if [[ "$temperature" -lt "$DAY_TEMP" ]] && is_active; then
      return
    fi
    if [[ "$temperature" -ge "$DAY_TEMP" ]] && ! is_active; then
      return
    fi
  fi

  pkill -x hyprsunset 2>/dev/null || true
  if [[ "$temperature" -lt "$DAY_TEMP" ]]; then
    hyprsunset -t "$temperature" >/dev/null 2>&1 &
  fi
  printf "%s" "$temperature" > "$TEMPERATURE_FILE"
}

apply_state() {
  set_temperature "$(desired_temperature)"
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

  icon="$("$HOME"/.config/hypr/runtime/desktop/nerd-icon-gen.sh "$glyph" 64 "$color" 2>/dev/null || printf "")"
  if [[ -n "$icon" && -f "$icon" ]]; then
    notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:night-light "$title" "$body" -i "$icon"
    return
  fi

  notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:night-light "$title" "$body"
}

next_boundary_epoch() {
  local candidate next now today tomorrow today_sunrise today_sunset tomorrow_sunrise tomorrow_sunset
  now="$(date +%s)"
  today="$(date +%F)"
  tomorrow="$(date -d tomorrow +%F)"
  today_sunrise="$(solar_event_epoch "$today" sunrise)"
  today_sunset="$(solar_event_epoch "$today" sunset)"
  tomorrow_sunrise="$(solar_event_epoch "$tomorrow" sunrise)"
  tomorrow_sunset="$(solar_event_epoch "$tomorrow" sunset)"

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
    if [[ -f "$OVERRIDE_FILE" && ! -f "$OVERRIDE_EXPIRY_FILE" ]]; then
      next_boundary_epoch > "$OVERRIDE_EXPIRY_FILE"
    fi

    if [[ -f "$OVERRIDE_EXPIRY_FILE" ]] && [[ "$(< "$OVERRIDE_EXPIRY_FILE")" -le "$(date +%s)" ]]; then
      rm -f "$OVERRIDE_FILE" "$OVERRIDE_EXPIRY_FILE"
    fi
    apply_state

    boundary="$(next_boundary_epoch)"
    now="$(date +%s)"
    sleep_for="$UPDATE_INTERVAL"
    if [[ $((boundary - now + 1)) -lt "$sleep_for" ]]; then
      sleep_for=$((boundary - now + 1))
    fi
    if [[ "$sleep_for" -lt 60 ]]; then
      sleep_for=60
    fi

    sleep "$sleep_for"
  done
}

toggle() {
  local boundary

  boundary="$(next_boundary_epoch)"
  if is_active; then
    printf "off" > "$OVERRIDE_FILE"
    printf "%s" "$boundary" > "$OVERRIDE_EXPIRY_FILE"
    apply_state
    notify_state false
    printf "Night light disabled\n"
    return
  fi

  printf "on" > "$OVERRIDE_FILE"
  printf "%s" "$boundary" > "$OVERRIDE_EXPIRY_FILE"
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

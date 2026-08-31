#!/usr/bin/env bash

set -euo pipefail

umask 077

STATE_DIR="${XDG_RUNTIME_DIR:-/tmp}/hypr-night-light"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
OVERRIDE_FILE="$STATE_DIR/override"
OVERRIDE_EXPIRY_FILE="$STATE_DIR/override-expiry"
LOCK_FILE="$STATE_DIR/daemon.lock"
TEMPERATURE_FILE="$STATE_DIR/temperature"
HYPRSUNSET_OWNER_FILE="$STATE_DIR/hyprsunset-owner"
RECOVERY_LOG_FILE="$STATE_DIR/last-recovery-log"
LIFECYCLE_FILE="$STATE_DIR/daemon.lifecycle"
HYPRSUNSET_SOCKET="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/hypr/${HYPRLAND_INSTANCE_SIGNATURE:-}/.hyprsunset.sock"

DAY_TEMP=6500
NIGHT_TEMP=4000
TRANSITION_SECONDS=3600
UPDATE_INTERVAL=300
RECOVERY_LOG_INTERVAL=300
CHILD_STOP_ATTEMPTS=20
CHILD_STOP_INTERVAL=0.05
LATITUDE=55.6761
LONGITUDE=12.5683
AUTO_SCHEDULE=true
ENABLED=false

mkdir -p "$STATE_DIR"

# shellcheck disable=SC2034
daemon_lifecycle_name="night-light"
# shellcheck disable=SC2034
daemon_lifecycle_file="$LIFECYCLE_FILE"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/../lib/daemon-lifecycle.sh"

atomic_write() {
  local target="$1" value="$2" temporary

  temporary="$(mktemp "$target.XXXXXX")"
  printf "%s\n" "$value" > "$temporary"
  mv -f "$temporary" "$target"
}

log_recovery() {
  local message="$1" now last_log=0

  now="$(date +%s)"
  if [[ -r "$RECOVERY_LOG_FILE" ]]; then
    read -r last_log < "$RECOVERY_LOG_FILE" || true
  fi
  if [[ "$last_log" =~ ^[0-9]+$ ]] && ((now - last_log < RECOVERY_LOG_INTERVAL)); then
    return
  fi

  atomic_write "$RECOVERY_LOG_FILE" "$now"
  printf 'night-light: %s\n' "$message" >&2
}

require_dependencies() {
  local dependency
  local -a missing=()

  for dependency in awk date flock mktemp nc hyprsunset; do
    command -v "$dependency" >/dev/null 2>&1 || missing+=("$dependency")
  done
  if ((${#missing[@]} == 0)); then
    return
  fi

  printf 'night-light: disabled: missing %s\n' "${missing[*]}" >&2
  return 1
}

process_start_time() {
  local pid="$1"

  awk '{ print $22 }' "/proc/$pid/stat" 2>/dev/null
}

owned_hyprsunset() {
  local pid start_time current_start_time process_name

  [[ -r "$HYPRSUNSET_OWNER_FILE" ]] || return 1
  read -r pid start_time < "$HYPRSUNSET_OWNER_FILE" || return 1
  if [[ ! "$pid" =~ ^[0-9]+$ || ! "$start_time" =~ ^[0-9]+$ ]]; then
    rm -f "$HYPRSUNSET_OWNER_FILE"
    return 1
  fi

  process_name=""
  if [[ -r "/proc/$pid/comm" ]]; then
    read -r process_name < "/proc/$pid/comm" || true
  fi
  current_start_time="$(process_start_time "$pid")"
  if [[ "$process_name" != "hyprsunset" || "$current_start_time" != "$start_time" ]]; then
    rm -f "$HYPRSUNSET_OWNER_FILE"
    return 1
  fi

  printf '%s %s\n' "$pid" "$start_time"
}

clear_hyprsunset_owner() {
  local pid="$1" start_time="$2" owner

  [[ -r "$HYPRSUNSET_OWNER_FILE" ]] || return
  owner="$(< "$HYPRSUNSET_OWNER_FILE")"
  [[ "$owner" == "$pid $start_time" ]] && rm -f "$HYPRSUNSET_OWNER_FILE"
}

wait_for_owned_hyprsunset() {
  local pid="$1" attempts=0

  while kill -0 "$pid" >/dev/null 2>&1; do
    if ((attempts >= CHILD_STOP_ATTEMPTS)); then
      return 1
    fi

    attempts=$((attempts + 1))
    sleep "$CHILD_STOP_INTERVAL"
  done
}

stop_owned_hyprsunset() {
  local owner pid start_time

  owner="$(owned_hyprsunset)" || return
  read -r pid start_time <<< "$owner"
  kill -TERM "$pid" >/dev/null 2>&1 || true
  if ! wait_for_owned_hyprsunset "$pid"; then
    log_recovery "forcing owned hyprsunset shutdown"
    kill -KILL "$pid" >/dev/null 2>&1 || true
    wait_for_owned_hyprsunset "$pid" || true
  fi
  wait "$pid" >/dev/null 2>&1 || true
  clear_hyprsunset_owner "$pid" "$start_time"
}

start_hyprsunset() {
  local temperature="$1" pid start_time

  if [[ -S "$HYPRSUNSET_SOCKET" ]]; then
    log_recovery "refusing to replace an unowned hyprsunset instance"
    return 1
  fi

  if [[ "$temperature" -ge "$DAY_TEMP" ]]; then
    hyprsunset -i >/dev/null 2>&1 &
  else
    hyprsunset -t "$temperature" >/dev/null 2>&1 &
  fi
  pid="$!"

  sleep "$CHILD_STOP_INTERVAL"
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    wait "$pid" >/dev/null 2>&1 || true
    log_recovery "owned hyprsunset exited during startup"
    return 1
  fi

  start_time="$(process_start_time "$pid")"
  if [[ ! "$start_time" =~ ^[0-9]+$ ]]; then
    kill -TERM "$pid" >/dev/null 2>&1 || true
    wait "$pid" >/dev/null 2>&1 || true
    log_recovery "could not record owned hyprsunset identity"
    return 1
  fi
  atomic_write "$HYPRSUNSET_OWNER_FILE" "$pid $start_time"
}

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
  local override scheduled

  if [[ -f "$OVERRIDE_FILE" ]]; then
    override="$(< "$OVERRIDE_FILE")"
    if [[ "$override" == "on" ]]; then
      if [[ "$AUTO_SCHEDULE" == "true" ]]; then
        scheduled="$(scheduled_temperature)"
        if [[ "$scheduled" -lt "$DAY_TEMP" ]]; then
          printf "%s" "$scheduled"
          return
        fi
      fi
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

hyprsunset_ipc() {
  local command="$1" response

  response="$(printf "%s" "$command" | nc -N -U "$HYPRSUNSET_SOCKET" 2>/dev/null)" || return 1
  [[ "$response" == "ok" ]]
}

is_enabled() {
  [[ "$(desired_temperature)" -lt "$DAY_TEMP" ]]
}

set_temperature() {
  local temperature="$1" previous_temperature="" owner pid start_time

  if [[ -f "$TEMPERATURE_FILE" ]]; then
    previous_temperature="$(< "$TEMPERATURE_FILE")"
  fi

  owner="$(owned_hyprsunset)" || owner=""
  if [[ "$temperature" == "$previous_temperature" ]]; then
    if [[ "$temperature" -lt "$DAY_TEMP" && -n "$owner" ]] && hyprsunset_ipc "temperature $temperature"; then
      return
    fi
    if [[ "$temperature" -ge "$DAY_TEMP" && -z "$owner" ]]; then
      return
    fi
  fi

  if [[ "$temperature" -ge "$DAY_TEMP" ]]; then
    if [[ -n "$owner" ]]; then
      if hyprsunset_ipc "identity"; then
        atomic_write "$TEMPERATURE_FILE" "$temperature"
        return
      fi

      log_recovery "owned hyprsunset IPC failed; restarting"
      stop_owned_hyprsunset
      start_hyprsunset "$temperature" || return 1
    fi
    atomic_write "$TEMPERATURE_FILE" "$temperature"
    return
  fi

  if [[ -n "$owner" ]] && hyprsunset_ipc "temperature $temperature"; then
    atomic_write "$TEMPERATURE_FILE" "$temperature"
    return
  fi

  if [[ -n "$owner" ]]; then
    log_recovery "owned hyprsunset IPC failed; restarting"
    stop_owned_hyprsunset
  fi
  start_hyprsunset "$temperature" || return 1
  atomic_write "$TEMPERATURE_FILE" "$temperature"
}

apply_state() {
  set_temperature "$(desired_temperature)"
}

notify_state() {
  local active="$1" temperature="${2:-$NIGHT_TEMP}"
  local icon title body color glyph

  if [[ "$active" == "true" ]]; then
    glyph="󰖔"
    color="#e67e22"
    title="Night Light Enabled"
    body="Color temperature set to ${temperature}K"
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

cleanup_daemon() {
  stop_owned_hyprsunset
  if [[ -n "$lifecycle_signal" ]]; then
    daemon_lifecycle_record_exit signal 0 "" "$lifecycle_signal"
    return
  fi

  daemon_lifecycle_record_exit clean-exit 0 ""
}

run_daemon() {
  local sleep_for boundary now status

  require_dependencies || return 0

  if [[ "${NIGHT_LIGHT_LOCK_HELD:-false}" != "true" ]]; then
    if flock -n -E 75 -o "$LOCK_FILE" env NIGHT_LIGHT_LOCK_HELD=true "$0" daemon; then
      return
    fi
    status=$?
    if [[ "$status" -eq 75 ]]; then
      exit 0
    fi
    return "$status"
  fi

  lifecycle_signal=""
  daemon_lifecycle_record_running ""
  trap cleanup_daemon EXIT
  trap 'lifecycle_signal=INT; exit 0' INT
  trap 'lifecycle_signal=TERM; exit 0' TERM

  while true; do
    if [[ -f "$OVERRIDE_FILE" && ! -f "$OVERRIDE_EXPIRY_FILE" ]]; then
      atomic_write "$OVERRIDE_EXPIRY_FILE" "$(next_boundary_epoch)"
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
  local boundary temperature

  boundary="$(next_boundary_epoch)"
  if is_enabled; then
    atomic_write "$OVERRIDE_FILE" "off"
    atomic_write "$OVERRIDE_EXPIRY_FILE" "$boundary"
    apply_state
    notify_state false
    printf "Night light disabled\n"
    return
  fi

  atomic_write "$OVERRIDE_FILE" "on"
  atomic_write "$OVERRIDE_EXPIRY_FILE" "$boundary"
  temperature="$(desired_temperature)"
  set_temperature "$temperature"
  notify_state true "$temperature"
  printf "Night light enabled\n"
}

case "${1:-toggle}" in
  daemon)
    run_daemon
    ;;
  sync)
    require_dependencies
    apply_state
    ;;
  toggle)
    require_dependencies
    toggle
    ;;
  is-active)
    require_dependencies
    is_enabled
    ;;
  status)
    require_dependencies
    if is_enabled; then
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

#!/usr/bin/env bash

set -euo pipefail

USER_PROFILE_BIN="/etc/profiles/per-user/${USER:-${HOME##*/}}/bin"
BASE_PATH="/run/current-system/sw/bin:/usr/bin:/bin"
if [[ -n "${PATH:-}" ]]; then
  export PATH="$PATH:$BASE_PATH"
else
  export PATH="$BASE_PATH"
fi
if [[ -d "$USER_PROFILE_BIN" ]]; then
  export PATH="$PATH:$USER_PROFILE_BIN"
fi

STATE_DIR="${XDG_RUNTIME_DIR:-/tmp}/hypr-profiles"
LOCK_FILE="$STATE_DIR/lock"

POWERSAVE_PROFILE="powersave"
GAMING_PROFILE="gaming"

mkdir -p "$STATE_DIR"
exec 9>"$LOCK_FILE"
flock 9

count_file() {
  local profile="$1"
  local source="$2"

  printf "%s/%s.%s.count" "$STATE_DIR" "$profile" "$source"
}

is_valid_profile() {
  local profile="$1"
  [[ "$profile" == "$POWERSAVE_PROFILE" || "$profile" == "$GAMING_PROFILE" ]]
}

get_count() {
  local profile="$1"
  local source="$2"
  local file
  file="$(count_file "$profile" "$source")"

  if [[ -f "$file" ]]; then
    cat "$file"
    return
  fi

  printf "0"
}

set_count() {
  local profile="$1"
  local source="$2"
  local value="$3"
  local file

  if [[ "$value" -lt 0 ]]; then
    value=0
  fi

  file="$(count_file "$profile" "$source")"
  printf "%s" "$value" > "$file"
}

get_profile_count() {
  local profile="$1"
  local total=0
  local file
  local value

  for file in "$STATE_DIR/$profile".*.count; do
    if [[ ! -f "$file" ]]; then
      continue
    fi

    value="$(< "$file")"
    if [[ "$value" =~ ^[0-9]+$ ]]; then
      total=$((total + value))
    fi
  done

  printf "%s" "$total"
}

is_valid_source() {
  local source="$1"
  [[ "$source" =~ ^[a-z][a-z0-9_-]*$ ]]
}

apply_hypr_powersave_overlay() {
  hyprctl eval 'require("profiles").apply("powersave")' >/dev/null
}

apply_hypr_gaming_overlay() {
  hyprctl eval 'require("profiles").apply("gaming")' >/dev/null
}

restore_hypr_defaults() {
  hyprctl reload >/dev/null
}

set_power_profile() {
	local profile="$1"

	if command -v powerprofilesctl >/dev/null 2>&1; then
		powerprofilesctl set "$profile" >/dev/null 2>&1 && return
	fi
}

pause_background_helpers() {
  pkill -STOP -f window-capture-daemon 2>/dev/null || true
  pkill -STOP -f waybar-edge-monitor 2>/dev/null || true
}

resume_background_helpers() {
  pkill -CONT -f window-capture-daemon 2>/dev/null || true
  pkill -CONT -f waybar-edge-monitor 2>/dev/null || true
}

refresh_window_captures() {
  local capture_daemon_script="$HOME/.config/hypr/runtime/windows/daemons/window-capture/window-capture-daemon.lua"

  if [[ -x "$capture_daemon_script" ]]; then
    ( sleep 0.3; "$capture_daemon_script" refresh-once >/dev/null 2>&1 ) &
  fi
}

set_switcher_mode_icons() {
  ags request --instance ags-bundled window-switcher '{"action": "set-mode", "mode": "icons"}' 2>/dev/null || true
}

set_switcher_mode_previews() {
  ags request --instance ags-bundled window-switcher '{"action": "set-mode", "mode": "previews"}' 2>/dev/null || true
}

overlay_active_file="$STATE_DIR/profile-overlay.active"
overlay_mode_file="$STATE_DIR/profile-overlay.mode"

get_desired_overlay_mode() {
  local powersave_count
  local gaming_count

  powersave_count="$(get_profile_count "$POWERSAVE_PROFILE")"
  gaming_count="$(get_profile_count "$GAMING_PROFILE")"

  if [[ "$gaming_count" -gt 0 ]]; then
    printf "gaming"
    return
  fi

  if [[ "$powersave_count" -gt 0 ]]; then
    printf "powersave"
    return
  fi

  printf "none"
}

apply_effective_state() {
  local desired_mode
  local current_mode="none"

  desired_mode="$(get_desired_overlay_mode)"

  if [[ -f "$overlay_mode_file" ]]; then
    current_mode="$(< "$overlay_mode_file")"
  fi

  if [[ "$desired_mode" == "none" && ( -f "$overlay_active_file" || -f "$overlay_mode_file" ) ]]; then
    resume_background_helpers
    set_switcher_mode_previews
    rm -f "$overlay_active_file" "$overlay_mode_file"
		set_power_profile balanced
    restore_hypr_defaults
    refresh_window_captures
    return
  fi

  if [[ "$desired_mode" == "none" ]]; then
    rm -f "$overlay_mode_file"
    return
  fi

  if [[ "$current_mode" != "$desired_mode" ]]; then
    if [[ -f "$overlay_active_file" ]]; then
      restore_hypr_defaults
    fi

    pause_background_helpers
		set_switcher_mode_icons
		if [[ "$desired_mode" == "gaming" ]]; then
			set_power_profile performance
			apply_hypr_gaming_overlay
		else
			set_power_profile power-saver
			apply_hypr_powersave_overlay
		fi
    touch "$overlay_active_file"
    printf "%s" "$desired_mode" > "$overlay_mode_file"
    return
  fi

  pause_background_helpers
	set_switcher_mode_icons
	if [[ "$desired_mode" == "gaming" ]]; then
		set_power_profile performance
		apply_hypr_gaming_overlay
	else
		set_power_profile power-saver
		apply_hypr_powersave_overlay
	fi
}

apply_profile() {
  local profile="$1"
  local source="${2:-manual}"
  local value

  value="$(get_count "$profile" "$source")"
  set_count "$profile" "$source" $((value + 1))
  apply_effective_state
}

remove_profile() {
  local profile="$1"
  local source="${2:-manual}"
  local value

  value="$(get_count "$profile" "$source")"
  set_count "$profile" "$source" $((value - 1))
  apply_effective_state
}

set_profile_count() {
  local profile="$1"
  local source="$2"
  local count="$3"

  set_count "$profile" "$source" "$count"
  apply_effective_state
}

print_status() {
  local powersave_count
  local gaming_count

  powersave_count="$(get_profile_count "$POWERSAVE_PROFILE")"
  gaming_count="$(get_profile_count "$GAMING_PROFILE")"

  printf "powersave=%s\n" "$powersave_count"
  printf "gaming=%s\n" "$gaming_count"

  if [[ -f "$overlay_active_file" ]]; then
    printf "overlay=active\n"
    return
  fi

  printf "overlay=inactive\n"
}

is_profile_active() {
  local profile="$1"
  local value

  value="$(get_profile_count "$profile")"
  if [[ "$value" -gt 0 ]]; then
    return 0
  fi

  return 1
}

is_source_active() {
  local profile="$1"
  local source="$2"
  local value

  value="$(get_count "$profile" "$source")"
  if [[ "$value" -gt 0 ]]; then
    return 0
  fi

  return 1
}

usage() {
  printf "usage: %s <apply|remove|toggle|sync|apply-source|remove-source|sync-source|is-active|is-source-active|status|reconcile> [profile] [source] [count]\n" "$0" >&2
}

main() {
  local command="${1:-}"
  local profile="${2:-}"

  case "$command" in
    apply)
      if is_valid_profile "$profile"; then
        :
      else
        usage
        exit 1
      fi
      apply_profile "$profile"
      ;;
    remove)
      if is_valid_profile "$profile"; then
        :
      else
        usage
        exit 1
      fi
      remove_profile "$profile"
      ;;
    toggle)
      if is_valid_profile "$profile"; then
        :
      else
        usage
        exit 1
      fi
      if is_source_active "$profile" manual; then
        remove_profile "$profile"
      else
        apply_profile "$profile"
      fi
      ;;
    apply-source)
      if is_valid_profile "$profile" && is_valid_source "${3:-}"; then
        :
      else
        usage
        exit 1
      fi
      apply_profile "$profile" "$3"
      ;;
    remove-source)
      if is_valid_profile "$profile" && is_valid_source "${3:-}"; then
        :
      else
        usage
        exit 1
      fi
      remove_profile "$profile" "$3"
      ;;
    sync)
      if is_valid_profile "$profile"; then
        :
      else
        usage
        exit 1
      fi

      if [[ "${3:-}" =~ ^[0-9]+$ ]]; then
        :
      else
        usage
        exit 1
      fi

      set_profile_count "$profile" watchdog "$3"
      ;;
    sync-source)
      if is_valid_profile "$profile" && is_valid_source "${3:-}"; then
        :
      else
        usage
        exit 1
      fi

      if [[ "${4:-}" =~ ^[0-9]+$ ]]; then
        :
      else
        usage
        exit 1
      fi

      set_profile_count "$profile" "$3" "$4"
      ;;
    is-active)
      if is_valid_profile "$profile"; then
        :
      else
        usage
        exit 1
      fi
      is_profile_active "$profile"
      ;;
    is-source-active)
      if is_valid_profile "$profile" && is_valid_source "${3:-}"; then
        :
      else
        usage
        exit 1
      fi
      is_source_active "$profile" "$3"
      ;;
    status)
      print_status
      ;;
    reconcile)
      apply_effective_state
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"

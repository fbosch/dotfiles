#!/usr/bin/env bash

set -euo pipefail

STATE_DIR="${XDG_RUNTIME_DIR:-/tmp}/hypr-profiles"
LOCK_FILE="$STATE_DIR/lock"

PERFORMANCE_PROFILE="performance"
GAMING_PROFILE="gaming"

mkdir -p "$STATE_DIR"
exec 9>"$LOCK_FILE"
flock 9

count_file() {
  local profile="$1"
  printf "%s/%s.count" "$STATE_DIR" "$profile"
}

is_valid_profile() {
  local profile="$1"
  [[ "$profile" == "$PERFORMANCE_PROFILE" || "$profile" == "$GAMING_PROFILE" ]]
}

get_count() {
  local profile="$1"
  local file
  file="$(count_file "$profile")"

  if [[ -f "$file" ]]; then
    cat "$file"
    return
  fi

  printf "0"
}

set_count() {
  local profile="$1"
  local value="$2"
  local file

  if [[ "$value" -lt 0 ]]; then
    value=0
  fi

  file="$(count_file "$profile")"
  printf "%s" "$value" > "$file"
}

apply_hypr_performance_overlay() {
  hyprctl --batch "keyword animations:enabled 0 ; keyword decoration:blur:passes 1 ; keyword decoration:shadow:enabled 0" >/dev/null
}

apply_hypr_gaming_overlay() {
  hyprctl --batch "keyword animations:enabled 0 ; keyword decoration:shadow:enabled 0 ; keyword decoration:blur:enabled 0 ; keyword decoration:inactive_opacity 1.0 ; keyword misc:vrr 2 ; keyword general:allow_tearing true" >/dev/null
}

restore_hypr_defaults() {
  hyprctl reload >/dev/null
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
  local capture_daemon_script="$HOME/.config/hypr/scripts/window-capture-daemon.sh"

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

overlay_active_file="$STATE_DIR/performance-overlay.active"
overlay_mode_file="$STATE_DIR/performance-overlay.mode"

get_desired_overlay_mode() {
  local performance_count
  local gaming_count

  performance_count="$(get_count "$PERFORMANCE_PROFILE")"
  gaming_count="$(get_count "$GAMING_PROFILE")"

  if [[ "$gaming_count" -gt 0 ]]; then
    printf "gaming"
    return
  fi

  if [[ "$performance_count" -gt 0 ]]; then
    printf "performance"
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

  if [[ "$desired_mode" == "none" && -f "$overlay_active_file" ]]; then
    resume_background_helpers
    set_switcher_mode_previews
    restore_hypr_defaults
    refresh_window_captures
    rm -f "$overlay_active_file" "$overlay_mode_file"
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
      apply_hypr_gaming_overlay
    else
      apply_hypr_performance_overlay
    fi
    touch "$overlay_active_file"
    printf "%s" "$desired_mode" > "$overlay_mode_file"
    return
  fi

  pause_background_helpers
  set_switcher_mode_icons
  if [[ "$desired_mode" == "gaming" ]]; then
    apply_hypr_gaming_overlay
  else
    apply_hypr_performance_overlay
  fi
}

apply_profile() {
  local profile="$1"
  local value

  value="$(get_count "$profile")"
  set_count "$profile" $((value + 1))
  apply_effective_state
}

remove_profile() {
  local profile="$1"
  local value

  value="$(get_count "$profile")"
  set_count "$profile" $((value - 1))
  apply_effective_state
}

set_profile_count() {
  local profile="$1"
  local count="$2"

  set_count "$profile" "$count"
  apply_effective_state
}

print_status() {
  local performance_count
  local gaming_count

  performance_count="$(get_count "$PERFORMANCE_PROFILE")"
  gaming_count="$(get_count "$GAMING_PROFILE")"

  printf "performance=%s\n" "$performance_count"
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

  value="$(get_count "$profile")"
  if [[ "$value" -gt 0 ]]; then
    return 0
  fi

  return 1
}

usage() {
  printf "usage: %s <apply|remove|toggle|sync|is-active|status|reconcile> [profile] [count]\n" "$0" >&2
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
      if is_profile_active "$profile"; then
        remove_profile "$profile"
      else
        apply_profile "$profile"
      fi
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

      set_profile_count "$profile" "$3"
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

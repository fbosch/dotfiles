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

set_switcher_mode_icons() {
  ags request --instance ags-bundled window-switcher '{"action": "set-mode", "mode": "icons"}' 2>/dev/null || true
}

set_switcher_mode_previews() {
  ags request --instance ags-bundled window-switcher '{"action": "set-mode", "mode": "previews"}' 2>/dev/null || true
}

overlay_active_file="$STATE_DIR/performance-overlay.active"

apply_effective_state() {
  local performance_count
  local gaming_count
  local should_enable_overlay

  performance_count="$(get_count "$PERFORMANCE_PROFILE")"
  gaming_count="$(get_count "$GAMING_PROFILE")"

  should_enable_overlay=0
  if [[ "$performance_count" -gt 0 || "$gaming_count" -gt 0 ]]; then
    should_enable_overlay=1
  fi

  if [[ "$should_enable_overlay" -eq 1 && ! -f "$overlay_active_file" ]]; then
    pause_background_helpers
    set_switcher_mode_icons
    apply_hypr_performance_overlay
    touch "$overlay_active_file"
    return
  fi

  if [[ "$should_enable_overlay" -eq 0 && -f "$overlay_active_file" ]]; then
    resume_background_helpers
    set_switcher_mode_previews
    restore_hypr_defaults
    rm -f "$overlay_active_file"
    return
  fi

  if [[ "$should_enable_overlay" -eq 1 && -f "$overlay_active_file" ]]; then
    pause_background_helpers
    set_switcher_mode_icons
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

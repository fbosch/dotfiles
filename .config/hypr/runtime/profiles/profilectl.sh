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
NOTIFY="$HOME/.config/hypr/runtime/notifications/notify.lua"

POWERSAVE_PROFILE="powersave"
GAMING_PROFILE="gaming"
DEFAULT_PROFILE="default"
AUTO_SELECTION="auto"
STATE_FILE="$STATE_DIR/state.json"
PROFILE_STATE_HELPER="$(dirname "$0")/profile-state.lua"
MAX_STATE_GENERATION=2147483647

mkdir -p "$STATE_DIR"
exec 9>"$LOCK_FILE"
flock 9

is_valid_profile() {
  local profile="$1"
  [[ "$profile" == "$POWERSAVE_PROFILE" || "$profile" == "$GAMING_PROFILE" ]]
}

is_valid_selection() {
  local selection="$1"
  [[ "$selection" == "$AUTO_SELECTION" || "$selection" == "$DEFAULT_PROFILE" ]] || is_valid_profile "$selection"
}

is_valid_source() {
  local source="$1"
  [[ "$source" =~ ^[a-z][a-z0-9_-]*$ ]]
}

normalize_count() {
  local count="$1"

  while [[ "${#count}" -gt 1 && "$count" == 0* ]]; do
    count="${count#0}"
  done

  printf "%s" "$count"
}

profile_state_tool() {
  if ! command -v luajit >/dev/null 2>&1; then
    printf "profilectl: luajit is required for profile state\n" >&2
    return 1
  fi

  if [[ ! -f "$PROFILE_STATE_HELPER" ]]; then
    printf "profilectl: missing profile state helper: %s\n" "$PROFILE_STATE_HELPER" >&2
    return 1
  fi

  luajit "$PROFILE_STATE_HELPER" "$@"
}

read_state_generation() {
  if [[ -L "$STATE_FILE" || ( -e "$STATE_FILE" && ! -f "$STATE_FILE" ) ]]; then
    printf "profilectl: invalid profile state path: %s\n" "$STATE_FILE" >&2
    return 1
  fi

  if [[ ! -e "$STATE_FILE" ]]; then
    printf "0"
    return
  fi

  profile_state_tool generation "$STATE_FILE"
}

read_state_source_count() {
  local profile="$1"
  local source="$2"

  if [[ ! -e "$STATE_FILE" ]]; then
    printf "0"
    return
  fi

  profile_state_tool source-count "$STATE_FILE" "$profile" "$source"
}

read_state_profile_count() {
  local profile="$1"

  if [[ ! -e "$STATE_FILE" ]]; then
    printf "0"
    return
  fi

  profile_state_tool profile-count "$STATE_FILE" "$profile"
}

read_state_selection() {
  if [[ ! -e "$STATE_FILE" ]]; then
    printf "%s" "$AUTO_SELECTION"
    return
  fi

  profile_state_tool selection "$STATE_FILE"
}

read_state_resolved() {
  if [[ ! -e "$STATE_FILE" ]]; then
    printf "%s" "$DEFAULT_PROFILE"
    return
  fi

  profile_state_tool resolved "$STATE_FILE"
}

emit_source_claims() {
  local changed_profile="${1:-}"
  local changed_source="${2:-}"
  local changed_count="${3:-}"
  local profile
  local source
  local count

  if [[ -e "$STATE_FILE" ]]; then
    while IFS=$'\t' read -r profile source count; do
      if [[ "$profile" == "$changed_profile" && "$source" == "$changed_source" ]]; then
        continue
      fi
      printf "%s\t%s\t%s\n" "$profile" "$source" "$count"
    done < <(profile_state_tool claims "$STATE_FILE")
  fi

  if [[ -n "$changed_profile" && "$changed_count" -gt 0 ]]; then
    printf "%s\t%s\t%s\n" "$changed_profile" "$changed_source" "$changed_count"
  fi
}

prepare_state() {
  local previous_generation="$1"
  local selection="$2"
  local resolved="$3"
  local changed_profile="${4:-}"
  local changed_source="${5:-}"
  local changed_count="${6:-}"
  local next_generation

  if [[ "$previous_generation" -ge "$MAX_STATE_GENERATION" ]]; then
    printf "profilectl: profile state generation limit reached\n" >&2
    return 1
  fi

  if [[ -L "$STATE_FILE" || ( -e "$STATE_FILE" && ! -f "$STATE_FILE" ) ]]; then
    printf "profilectl: invalid profile state path: %s\n" "$STATE_FILE" >&2
    return 1
  fi

  next_generation=$((previous_generation + 1))

  emit_source_claims "$changed_profile" "$changed_source" "$changed_count" \
    | profile_state_tool encode "$next_generation" "$selection" "$resolved"
}

publish_state() {
  local state="$1"
  local temporary

  temporary="$(mktemp "$STATE_DIR/.state.XXXXXX")" || return 1
  if ! printf "%s" "$state" > "$temporary"; then
    rm -f "$temporary"
    return 1
  fi

  if ! mv -f "$temporary" "$STATE_FILE"; then
    rm -f "$temporary"
    return 1
  fi
}

get_desired_profile() {
  local selection="$1"
  local gaming_count="$2"
  local powersave_count="$3"

  if [[ "$selection" != "$AUTO_SELECTION" ]]; then
    printf "%s" "$selection"
    return
  fi

  if [[ "$gaming_count" -gt 0 ]]; then
    printf "%s" "$GAMING_PROFILE"
    return
  fi

  if [[ "$powersave_count" -gt 0 ]]; then
    printf "%s" "$POWERSAVE_PROFILE"
    return
  fi

  printf "%s" "$DEFAULT_PROFILE"
}

apply_hypr_powersave_overlay() {
  hyprctl eval 'require("profiles").apply("powersave")' >/dev/null
}

apply_hypr_gaming_overlay() {
  hyprctl eval 'require("profiles").apply("gaming")' >/dev/null
}

restore_hypr_defaults() {
  if ! hyprctl reload >/dev/null; then
    return 1
  fi

  if ! hyprctl eval 'require("profiles").apply("default")' >/dev/null; then
    return 1
  fi

}

notify_failure() {
  local key="$1"
  local summary="$2"
  local body="$3"
  "$NOTIFY" error "$key" "$summary" "$body" >/dev/null 2>&1 || true
}

rollback_overlay() {
  resume_background_helpers
  set_power_profile balanced
  if ! restore_hypr_defaults; then
    return 1
  fi

  refresh_window_captures
}

notify_apply_failure() {
  local summary="$1"

  if rollback_overlay; then
    notify_failure "profile-apply" "$summary" "The previous profile was restored."
    return
  fi

  notify_failure "profile-rollback" "$summary" "Rollback failed. Run profilectl reconcile."
}

set_power_profile() {
  local profile="$1"

  if command -v powerprofilesctl >/dev/null 2>&1; then
    if powerprofilesctl set "$profile" >/dev/null 2>&1; then
      return
    fi

    printf "profilectl: failed to set power profile to %s\n" "$profile" >&2
  fi
}

pause_background_helpers() {
  "$HOME/.config/hypr/runtime/windows/daemons/window-capture/window-capturectl.sh" pause >/dev/null 2>&1 || true
}

resume_background_helpers() {
  "$HOME/.config/hypr/runtime/windows/daemons/window-capture/window-capturectl.sh" resume >/dev/null 2>&1 || true
}

refresh_window_captures() {
  local capturectl="$HOME/.config/hypr/runtime/windows/daemons/window-capture/window-capturectl.sh"

  if [[ -x "$capturectl" ]]; then
    ( sleep 0.3; "$capturectl" refresh >/dev/null 2>&1 ) &
  fi
}

apply_effective_state() {
  local desired="$1"
  local force_restore="${2:-false}"
  local current

  current="$(read_state_resolved)" || return 1
  if [[ "$desired" == "$DEFAULT_PROFILE" ]]; then
    if [[ "$current" == "$DEFAULT_PROFILE" && "$force_restore" == "false" ]]; then
      return
    fi

    resume_background_helpers
    set_power_profile balanced
    if ! restore_hypr_defaults; then
      notify_failure "profile-restore" "Hyprland profile restore failed" "Gaming settings may still be active."
      return 1
    fi
    refresh_window_captures
    return
  fi

  if [[ "$force_restore" == "true" || ( "$current" != "$DEFAULT_PROFILE" && "$current" != "$desired" ) ]]; then
    if ! restore_hypr_defaults; then
      notify_failure "profile-restore" "Hyprland profile restore failed" "The previous profile could not be cleared."
      return 1
    fi
  fi

  pause_background_helpers
  if [[ "$desired" == "$GAMING_PROFILE" ]]; then
      set_power_profile performance
      if ! apply_hypr_gaming_overlay; then
        notify_apply_failure "Gaming profile failed"
        return 1
      fi
    return
  fi

    set_power_profile power-saver
    if ! apply_hypr_powersave_overlay; then
      notify_apply_failure "Power-save profile failed"
      return 1
    fi
}

apply_profile() {
  local profile="$1"
  local source="${2:-manual}"
  local value

  if [[ "$source" == "manual" ]]; then
    set_manual_profile "$profile"
    return
  fi

  value="$(read_state_source_count "$profile" "$source")" || return 1
  set_profile_count "$profile" "$source" $((value + 1))
}

remove_profile() {
  local profile="$1"
  local source="${2:-manual}"
  local value

  if [[ "$source" == "manual" ]]; then
    if [[ "$(read_state_selection)" == "$profile" ]]; then
      set_manual_profile "$AUTO_SELECTION"
    fi
    return
  fi

  value="$(read_state_source_count "$profile" "$source")" || return 1
  set_profile_count "$profile" "$source" $((value - 1))
}

set_profile_count() {
  local profile="$1"
  local source="$2"
  local count="$3"
  local previous_count
  local previous_generation
  local selection
  local gaming_count
  local powersave_count
  local desired
  local state
  local previous_resolved

  count="$(normalize_count "$count")"
  if [[ "$count" -lt 0 ]]; then
    count=0
  fi

  if [[ "$source" == "manual" ]]; then
    if [[ "$count" -gt 0 ]]; then
      set_manual_profile "$profile"
      return
    fi

    if [[ "$(read_state_selection)" == "$profile" ]]; then
      set_manual_profile "$AUTO_SELECTION"
    fi
    return
  fi

  previous_generation="$(read_state_generation)" || return 1
  previous_resolved="$(read_state_resolved)" || return 1
  previous_count="$(read_state_source_count "$profile" "$source")" || return 1
  if [[ "$previous_count" == "$count" && -e "$STATE_FILE" ]]; then
    return
  fi

  selection="$(read_state_selection)" || return 1
  gaming_count="$(read_state_profile_count "$GAMING_PROFILE")"
  powersave_count="$(read_state_profile_count "$POWERSAVE_PROFILE")"
  if [[ "$profile" == "$GAMING_PROFILE" ]]; then gaming_count=$((gaming_count - previous_count + count)); fi
  if [[ "$profile" == "$POWERSAVE_PROFILE" ]]; then powersave_count=$((powersave_count - previous_count + count)); fi
  desired="$(get_desired_profile "$selection" "$gaming_count" "$powersave_count")"
  state="$(prepare_state "$previous_generation" "$selection" "$desired" "$profile" "$source" "$count")" || return 1
  if ! apply_effective_state "$desired"; then
    apply_effective_state "$previous_resolved" true || true
    return 1
  fi
  if ! publish_state "$state"; then
    apply_effective_state "$previous_resolved" true || true
    return 1
  fi
}

set_manual_profile() {
  local selection="$1"
  local previous_generation
  local gaming_count
  local powersave_count
  local desired
  local state
  local previous_resolved

  if ! is_valid_selection "$selection"; then
    usage
    return 1
  fi

  previous_generation="$(read_state_generation)" || return 1
  previous_resolved="$(read_state_resolved)" || return 1
  if [[ -e "$STATE_FILE" && "$(read_state_selection)" == "$selection" ]]; then
    return
  fi
  gaming_count="$(read_state_profile_count "$GAMING_PROFILE")"
  powersave_count="$(read_state_profile_count "$POWERSAVE_PROFILE")"
  desired="$(get_desired_profile "$selection" "$gaming_count" "$powersave_count")"
  state="$(prepare_state "$previous_generation" "$selection" "$desired")" || return 1
  if ! apply_effective_state "$desired" true; then
    apply_effective_state "$previous_resolved" true || true
    return 1
  fi
  if ! publish_state "$state"; then
    apply_effective_state "$previous_resolved" true || true
    return 1
  fi
}

reconcile_profile_state() {
  local previous_generation

  previous_generation="$(read_state_generation)" || return 1
  local selection gaming_count powersave_count desired state

  selection="$(read_state_selection)" || return 1
  gaming_count="$(read_state_profile_count "$GAMING_PROFILE")"
  powersave_count="$(read_state_profile_count "$POWERSAVE_PROFILE")"
  desired="$(get_desired_profile "$selection" "$gaming_count" "$powersave_count")"
  state="$(prepare_state "$previous_generation" "$selection" "$desired")" || return 1
  apply_effective_state "$desired" true || return 1
  publish_state "$state"
}

print_status() {
  local powersave_count
  local gaming_count
  local selection

  powersave_count="$(read_state_profile_count "$POWERSAVE_PROFILE")"
  gaming_count="$(read_state_profile_count "$GAMING_PROFILE")"
  selection="$(read_state_selection)" || return 1

  if [[ "$selection" == "$POWERSAVE_PROFILE" ]]; then powersave_count=$((powersave_count + 1)); fi
  if [[ "$selection" == "$GAMING_PROFILE" ]]; then gaming_count=$((gaming_count + 1)); fi

  printf "selection=%s\n" "$selection"
  printf "powersave=%s\n" "$powersave_count"
  printf "gaming=%s\n" "$gaming_count"

  if [[ "$(read_state_resolved)" != "$DEFAULT_PROFILE" ]]; then
    printf "overlay=active\n"
    return
  fi

  printf "overlay=inactive\n"
}

print_json_status() {
  if [[ ! -e "$STATE_FILE" ]]; then
    printf "profilectl: profile state has not been published\n" >&2
    return 1
  fi

  read_state_generation >/dev/null || return 1
  cat "$STATE_FILE"
}

is_profile_active() {
  local profile="$1"

  [[ "$(read_state_selection)" == "$profile" ]] && return 0
  [[ "$(read_state_profile_count "$profile")" -gt 0 ]]
}

is_source_active() {
  local profile="$1"
  local source="$2"
  local value

  if [[ "$source" == "manual" ]]; then
    [[ "$(read_state_selection)" == "$profile" ]]
    return
  fi

  value="$(read_state_source_count "$profile" "$source")"
  if [[ "$value" -gt 0 ]]; then
    return 0
  fi

  return 1
}

usage() {
  printf "usage: %s <apply|remove|toggle|sync|apply-source|remove-source|sync-source|set-manual|clear-manual|is-active|is-source-active|status [--json]|reconcile> [profile] [source] [count]\n" "$0" >&2
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
    set-manual)
      set_manual_profile "$profile"
      ;;
    clear-manual)
      set_manual_profile "$AUTO_SELECTION"
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
      case "$profile" in
        "")
          print_status
          ;;
        --json)
          print_json_status
          ;;
        *)
          usage
          exit 1
          ;;
      esac
      ;;
    reconcile)
      reconcile_profile_state
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"

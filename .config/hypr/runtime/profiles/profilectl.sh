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
MANUAL_SELECTION_FILE="$STATE_DIR/manual-selection"
STATE_FILE="$STATE_DIR/state.json"
PROFILE_STATE_HELPER="$(dirname "$0")/profile-state.lua"
MAX_STATE_GENERATION=2147483647

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

is_valid_selection() {
  local selection="$1"
  [[ "$selection" == "$AUTO_SELECTION" || "$selection" == "$DEFAULT_PROFILE" ]] || is_valid_profile "$selection"
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

get_manual_selection() {
  local selection
  local gaming_manual
  local powersave_manual

  if [[ -e "$MANUAL_SELECTION_FILE" ]]; then
    if [[ -L "$MANUAL_SELECTION_FILE" || ! -f "$MANUAL_SELECTION_FILE" ]]; then
      printf "profilectl: invalid manual selection path: %s\n" "$MANUAL_SELECTION_FILE" >&2
      return 1
    fi

    selection="$(< "$MANUAL_SELECTION_FILE")"
    if is_valid_selection "$selection"; then
      printf "%s" "$selection"
      return
    fi

    printf "profilectl: invalid manual selection: %s\n" "$selection" >&2
    return 1
  fi

  gaming_manual="$(get_count "$GAMING_PROFILE" manual)"
  powersave_manual="$(get_count "$POWERSAVE_PROFILE" manual)"
  if [[ "$gaming_manual" -gt 0 ]]; then
    printf "%s" "$GAMING_PROFILE"
    return
  fi

  if [[ "$powersave_manual" -gt 0 ]]; then
    printf "%s" "$POWERSAVE_PROFILE"
    return
  fi

  printf "%s" "$AUTO_SELECTION"
}

write_manual_selection() {
  local selection="$1"
  local temporary

  if ! is_valid_selection "$selection"; then
    return 1
  fi

  if [[ -L "$MANUAL_SELECTION_FILE" || ( -e "$MANUAL_SELECTION_FILE" && ! -f "$MANUAL_SELECTION_FILE" ) ]]; then
    printf "profilectl: invalid manual selection path: %s\n" "$MANUAL_SELECTION_FILE" >&2
    return 1
  fi

  temporary="$(mktemp "$STATE_DIR/.manual-selection.XXXXXX")" || return 1
  if ! printf "%s" "$selection" > "$temporary"; then
    rm -f "$temporary"
    return 1
  fi

  if ! mv -f "$temporary" "$MANUAL_SELECTION_FILE"; then
    rm -f "$temporary"
    return 1
  fi
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

get_automatic_profile_count() {
  local profile="$1"
  local total=0
  local file
  local value

  for file in "$STATE_DIR/$profile".*.count; do
    if [[ ! -f "$file" || "$file" == *.manual.count ]]; then
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

  profile_state_tool source-count "$STATE_FILE" "$profile" "$source"
}

canonical_profile() {
  local mode="$1"

  if [[ "$mode" == "none" ]]; then
    printf "%s" "$DEFAULT_PROFILE"
    return
  fi

  printf "%s" "$mode"
}

emit_source_claims() {
  local profile="$1"
  local file
  local source
  local count

  for file in "$STATE_DIR/$profile".*.count; do
    if [[ ! -f "$file" || "$file" == *.manual.count ]]; then
      continue
    fi

    source="${file#"$STATE_DIR/$profile."}"
    source="${source%.count}"
    count="$(< "$file")"
    if is_valid_source "$source" && [[ "$count" =~ ^[0-9]+$ && "$count" -gt 0 ]]; then
      printf "%s\t%s\t%s\n" "$profile" "$source" "$count"
    fi
  done
}

publish_state() {
  local previous_generation="$1"
  local next_generation
  local selection
  local desired
  local resolved
  local temporary

  if [[ "$previous_generation" -ge "$MAX_STATE_GENERATION" ]]; then
    printf "profilectl: profile state generation limit reached\n" >&2
    return 1
  fi

  if [[ -L "$STATE_FILE" || ( -e "$STATE_FILE" && ! -f "$STATE_FILE" ) ]]; then
    printf "profilectl: invalid profile state path: %s\n" "$STATE_FILE" >&2
    return 1
  fi

  selection="$(get_manual_selection)" || return 1
  desired="$(get_desired_overlay_mode)" || return 1
  resolved="$(canonical_profile "$desired")"
  next_generation=$((previous_generation + 1))
  temporary="$(mktemp "$STATE_DIR/.state.XXXXXX")" || return 1

  if ! { emit_source_claims "$GAMING_PROFILE"; emit_source_claims "$POWERSAVE_PROFILE"; } \
    | profile_state_tool encode "$next_generation" "$selection" "$resolved" > "$temporary"; then
    rm -f "$temporary"
    return 1
  fi

  if [[ "$(profile_state_tool generation "$temporary")" != "$next_generation" ]]; then
    rm -f "$temporary"
    return 1
  fi

  if ! mv -f "$temporary" "$STATE_FILE"; then
    rm -f "$temporary"
    return 1
  fi
}

apply_and_publish_effective_state() {
  local previous_generation="$1"
  local force_restore="${2:-false}"

  apply_effective_state "$force_restore" || return 1
  publish_state "$previous_generation"
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

  remove_overlay_markers
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
    touch "$overlay_active_file" || true
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

overlay_active_file="$STATE_DIR/profile-overlay.active"
overlay_mode_file="$STATE_DIR/profile-overlay.mode"

write_overlay_mode() {
  local mode="$1"
  local temporary

  if [[ -L "$overlay_mode_file" || ( -e "$overlay_mode_file" && ! -f "$overlay_mode_file" ) ]]; then
    printf "profilectl: invalid overlay mode path: %s\n" "$overlay_mode_file" >&2
    return 1
  fi

  temporary="$(mktemp "$STATE_DIR/.profile-overlay.mode.XXXXXX")" || return 1
  if ! printf "%s" "$mode" > "$temporary"; then
    rm -f "$temporary"
    return 1
  fi

  if ! mv -f "$temporary" "$overlay_mode_file"; then
    rm -f "$temporary"
    return 1
  fi
}

remove_overlay_markers() {
  if [[ -L "$overlay_mode_file" || ( -e "$overlay_mode_file" && ! -f "$overlay_mode_file" ) ]]; then
    return 1
  fi

  if [[ -L "$overlay_active_file" || ( -e "$overlay_active_file" && ! -f "$overlay_active_file" ) ]]; then
    return 1
  fi

  rm -f "$overlay_mode_file" || return 1
  rm -f "$overlay_active_file"
}

get_desired_overlay_mode() {
  local powersave_count
  local gaming_count
  local selection

  selection="$(get_manual_selection)" || return 1
  if [[ "$selection" == "$DEFAULT_PROFILE" ]]; then
    printf "none"
    return
  fi

  if [[ "$selection" != "$AUTO_SELECTION" ]]; then
    printf "%s" "$selection"
    return
  fi

  powersave_count="$(get_automatic_profile_count "$POWERSAVE_PROFILE")"
  gaming_count="$(get_automatic_profile_count "$GAMING_PROFILE")"

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
  local force_restore="${1:-false}"
  local desired_mode
  local current_mode="none"

  desired_mode="$(get_desired_overlay_mode)"

  if [[ -f "$overlay_mode_file" ]]; then
    current_mode="$(< "$overlay_mode_file")"
  fi

   if [[ "$desired_mode" == "none" && ( -f "$overlay_active_file" || -f "$overlay_mode_file" || "$force_restore" == "true" ) ]]; then
     resume_background_helpers
    set_power_profile balanced
    if ! restore_hypr_defaults; then
      notify_failure "profile-restore" "Hyprland profile restore failed" "Gaming settings may still be active."
      return 1
    fi
    refresh_window_captures
    return
  fi

  if [[ "$desired_mode" == "none" ]]; then
    remove_overlay_markers
    return
  fi

  if [[ "$current_mode" != "$desired_mode" ]]; then
    if [[ -f "$overlay_active_file" ]]; then
      if ! restore_hypr_defaults; then
        notify_failure "profile-restore" "Hyprland profile restore failed" "The previous profile could not be cleared."
        return 1
      fi
    fi

    pause_background_helpers
    if [[ "$desired_mode" == "gaming" ]]; then
      set_power_profile performance
      if ! apply_hypr_gaming_overlay; then
        notify_apply_failure "Gaming profile failed"
        return 1
      fi
    else
      set_power_profile power-saver
      if ! apply_hypr_powersave_overlay; then
        notify_apply_failure "Power-save profile failed"
        return 1
      fi
    fi
    if ! write_overlay_mode "$desired_mode"; then
      notify_apply_failure "Profile state publication failed"
      return 1
    fi
    touch "$overlay_active_file"
    return
  fi

  pause_background_helpers
  if [[ "$desired_mode" == "gaming" ]]; then
    set_power_profile performance
    if ! apply_hypr_gaming_overlay; then
      notify_apply_failure "Gaming profile failed"
      return 1
    fi
  else
    set_power_profile power-saver
    if ! apply_hypr_powersave_overlay; then
      notify_apply_failure "Power-save profile failed"
      return 1
    fi
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

  value="$(get_count "$profile" "$source")"
  set_profile_count "$profile" "$source" $((value + 1))
}

remove_profile() {
  local profile="$1"
  local source="${2:-manual}"
  local value

  if [[ "$source" == "manual" ]]; then
    if [[ "$(get_manual_selection)" == "$profile" ]]; then
      set_manual_profile "$AUTO_SELECTION"
    fi
    return
  fi

  value="$(get_count "$profile" "$source")"
  set_profile_count "$profile" "$source" $((value - 1))
}

set_profile_count() {
  local profile="$1"
  local source="$2"
  local count="$3"
  local previous_count
  local previous_generation
  local canonical_count

  count="$(normalize_count "$count")"

  if [[ "$source" == "manual" ]]; then
    if [[ "$count" -gt 0 ]]; then
      set_manual_profile "$profile"
      return
    fi

    if [[ "$(get_manual_selection)" == "$profile" ]]; then
      set_manual_profile "$AUTO_SELECTION"
    fi
    return
  fi

  previous_generation="$(read_state_generation)" || return 1
  previous_count="$(get_count "$profile" "$source")"
  if [[ "$previous_count" == "$count" && -e "$STATE_FILE" ]]; then
    canonical_count="$(read_state_source_count "$profile" "$source")" || return 1
    if [[ "$canonical_count" == "$count" ]]; then
      return
    fi
  fi

  set_count "$profile" "$source" "$count"
  if ! apply_and_publish_effective_state "$previous_generation"; then
    set_count "$profile" "$source" "$previous_count"
    apply_effective_state || true
    return 1
  fi
}

restore_manual_counts() {
  local gaming_count="$1"
  local powersave_count="$2"

  set_count "$GAMING_PROFILE" manual "$gaming_count" || true
  set_count "$POWERSAVE_PROFILE" manual "$powersave_count" || true
}

restore_manual_selection() {
  write_manual_selection "$1" || true
}

set_manual_profile() {
  local selection="$1"
  local previous_gaming
  local previous_powersave
  local previous_selection
  local previous_generation

  if ! is_valid_selection "$selection"; then
    usage
    return 1
  fi

  previous_generation="$(read_state_generation)" || return 1
  previous_selection="$(get_manual_selection)" || return 1
  previous_gaming="$(get_count "$GAMING_PROFILE" manual)"
  previous_powersave="$(get_count "$POWERSAVE_PROFILE" manual)"

  if ! set_count "$GAMING_PROFILE" manual 0 || ! set_count "$POWERSAVE_PROFILE" manual 0; then
    restore_manual_counts "$previous_gaming" "$previous_powersave"
    return 1
  fi

  if [[ "$selection" == "$GAMING_PROFILE" ]]; then
    if ! set_count "$GAMING_PROFILE" manual 1; then
      restore_manual_counts "$previous_gaming" "$previous_powersave"
      return 1
    fi
  elif [[ "$selection" == "$POWERSAVE_PROFILE" ]]; then
    if ! set_count "$POWERSAVE_PROFILE" manual 1; then
      restore_manual_counts "$previous_gaming" "$previous_powersave"
      return 1
    fi
  fi

  if ! write_manual_selection "$selection"; then
    restore_manual_counts "$previous_gaming" "$previous_powersave"
    return 1
  fi

  if ! apply_and_publish_effective_state "$previous_generation" true; then
    restore_manual_counts "$previous_gaming" "$previous_powersave"
    restore_manual_selection "$previous_selection"
    apply_effective_state true || true
    return 1
  fi
}

reconcile_profile_state() {
  local previous_generation

  previous_generation="$(read_state_generation)" || return 1
  apply_and_publish_effective_state "$previous_generation" true
}

print_status() {
  local powersave_count
  local gaming_count
  local selection

  powersave_count="$(get_profile_count "$POWERSAVE_PROFILE")"
  gaming_count="$(get_profile_count "$GAMING_PROFILE")"
  selection="$(get_manual_selection)" || return 1

  printf "selection=%s\n" "$selection"
  printf "powersave=%s\n" "$powersave_count"
  printf "gaming=%s\n" "$gaming_count"

  if [[ -f "$overlay_active_file" ]]; then
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

  if [[ "$source" == "manual" ]]; then
    [[ "$(get_manual_selection)" == "$profile" ]]
    return
  fi

  value="$(get_count "$profile" "$source")"
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

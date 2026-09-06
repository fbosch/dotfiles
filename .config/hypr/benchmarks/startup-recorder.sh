#!/usr/bin/env bash

set -euo pipefail
umask 077

state_root="${HYPR_STARTUP_BENCHMARK_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/hypr-startup-benchmark}"
readonly state_root
readonly markers=(waybar-layer-mapped ags-component-host-main-complete)
readonly target_runs=3
readonly capture_timeout_seconds=120

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly script_dir
readonly waybar_process="$script_dir/../runtime/desktop/waybar-process.sh"
readonly default_mode="eager"
fail() {
  printf '%s\n' "$*" >&2
  exit 2
}

read_file() {
  local path="$1"
  [[ -r "$path" ]] || return 1
  IFS= read -r REPLY <"$path"
  printf '%s' "$REPLY"
}

is_session() {
  [[ "$1" =~ ^[a-zA-Z0-9._-]{1,200}$ ]]
}

is_marker() {
  local marker="$1"
  local known
  for known in "${markers[@]}"; do
    [[ "$marker" == "$known" ]] && return 0
  done
  return 1
}

valid_stamp() {
  [[ "$1" =~ ^[0-9]+\.[0-9]{9}$ ]]
}

boot_id() {
  read_file /proc/sys/kernel/random/boot_id 2>/dev/null || printf 'unavailable'
}

campaign_dir() {
  local campaign
  campaign="$(read_file "$state_root/current" 2>/dev/null || true)"
  [[ -n "$campaign" ]] || return 1
  printf '%s/campaigns/%s' "$state_root" "$campaign"
}

campaign_mode() {
  local campaign mode
  campaign="$(campaign_dir)" || return 1
  mode="$(sed -n 's/^mode=//p' "$campaign/metadata" 2>/dev/null | head -n 1)"
  case "$mode" in
    eager|lazy-waybar) printf '%s' "$mode" ;;
    *) printf '%s' "$default_mode" ;;
  esac
}

capture_waybar_state() {
  local session="$1" layers unit
  if [[ ! -x "$waybar_process" ]]; then
    printf 'indeterminate'
    return
  fi
  if ! layers="$(HYPRLAND_INSTANCE_SIGNATURE="$session" timeout --foreground 1s hyprctl -j layers 2>/dev/null)" \
    || ! jq -e 'type == "object"' >/dev/null 2>&1 <<<"$layers"; then
    printf 'indeterminate'
    return
  fi
  if jq -e '[.. | objects | select(.namespace? == "waybar")] | length > 0' >/dev/null 2>&1 <<<"$layers"; then
    printf 'mapped'
    return
  fi
  if HYPRLAND_INSTANCE_SIGNATURE="$session" "$waybar_process" running >/dev/null 2>&1; then
    printf 'process-unmapped'
    return
  fi
  unit="$(HYPRLAND_INSTANCE_SIGNATURE="$session" "$waybar_process" unit-name 2>/dev/null || true)"
  if [[ -z "$unit" ]]; then
    printf 'indeterminate'
  elif systemctl --user is-active --quiet "$unit" 2>/dev/null; then
    printf 'service-active'
  else
    printf 'absent'
  fi
}

lock_campaign() {
  mkdir -p "$state_root"
  exec {campaign_lock_fd}>"$state_root/capture.lock"
  flock "$campaign_lock_fd"
}

resolve_run() {
  local session="$1" create="${2:-false}"
  local campaign mapping run count excluded
  campaign="$(campaign_dir)" || return 1
  mapping="$campaign/sessions/$session"
  run="$(read_file "$mapping" 2>/dev/null || true)"
  if [[ "$run" =~ ^run-[1-3]$ && -d "$campaign/$run" ]]; then
    REPLY="$campaign/$run"
    return 0
  fi
  [[ "$create" == "true" ]] || return 1
  excluded="$(read_file "$campaign/excluded-session" 2>/dev/null || true)"
  [[ "$session" != "$excluded" ]] || return 1
  count="$(find "$campaign" -mindepth 1 -maxdepth 1 -type d -name 'run-*' -printf . | wc -c)"
  (( count < target_runs )) || return 1
  run="run-$((count + 1))"
  mkdir "$campaign/$run"
  printf '%s\n' "$session" >"$campaign/$run/session"
  printf '%s\n' "$(boot_id)" >"$campaign/$run/boot-id"
  printf '%s\n' "$run" >"$mapping"
  REPLY="$campaign/$run"
}

write_once() {
  local path="$1" value="$2"
  [[ ! -e "$path" ]] || return 0
  (set -o noclobber; printf '%s\n' "$value" >"$path") 2>/dev/null || true
}

same_boot() {
  local run_dir="$1"
  [[ "$(read_file "$run_dir/boot-id" 2>/dev/null || true)" == "$(boot_id)" ]]
}

run_is_valid_complete() {
  local run_dir="$1" start waybar ags mode
  [[ ! -e "$run_dir/boot-mismatch" && ! -e "$run_dir/timed-out" ]] || return 1
  start="$(read_file "$run_dir/compositor-start" 2>/dev/null || true)"
  ags="$(read_file "$run_dir/ags-component-host-main-complete" 2>/dev/null || true)"
  [[ -n "$start" && -n "$ags" ]] || return 1
  mode="$(campaign_mode)" || return 1
  if [[ "$mode" == "lazy-waybar" ]]; then
    [[ "$(read_file "$run_dir/waybar-at-ags-ready" 2>/dev/null || true)" == "absent" ]] || return 1
    awk -v start="$start" -v ags="$ags" -v timeout="$capture_timeout_seconds" \
      'BEGIN { exit !(start <= ags && ags - start <= timeout) }'
    return
  fi
  waybar="$(read_file "$run_dir/waybar-layer-mapped" 2>/dev/null || true)"
  [[ -n "$waybar" ]] || return 1
  awk -v start="$start" -v waybar="$waybar" -v ags="$ags" -v timeout="$capture_timeout_seconds" \
    'BEGIN { exit !(start <= waybar && start <= ags && waybar - start <= timeout && ags - start <= timeout) }'
}

finish_if_complete() {
  local campaign count run
  campaign="$(campaign_dir)" || return 0
  count="$(find "$campaign" -mindepth 1 -maxdepth 1 -type d -name 'run-*' -printf . | wc -c)"
  (( count == target_runs )) || return 0
  for run in "$campaign"/run-*; do
    run_is_valid_complete "$run" || return 0
  done
  rm -f "$state_root/armed"
}

arm() {
  [[ ! -e "$state_root/armed" ]] || fail "already armed; disarm before arming a new three-login capture"
  local mode="${1:-$default_mode}" current_session="${HYPRLAND_INSTANCE_SIGNATURE:-}"
  case "$mode" in
    eager|lazy-waybar) ;;
    *) fail "unknown capture mode: $mode" ;;
  esac
  is_session "$current_session" || fail "arm must run inside a Hyprland session"
  local campaign
  campaign="$(date -u +%Y%m%dT%H%M%S.%NZ)-$(boot_id)"
  mkdir -p "$state_root/campaigns/$campaign/sessions"
  printf '%s\n' "$campaign" >"$state_root/current"
  {
    printf 'target_runs=%s\n' "$target_runs"
    printf 'mode=%s\n' "$mode"
    printf 'clock=/proc/uptime (boot-relative, approximately 10 ms resolution)\n'
  } >"$state_root/campaigns/$campaign/metadata"
  printf '%s\n' "$current_session" >"$state_root/campaigns/$campaign/excluded-session"
  : >"$state_root/armed"
  printf 'armed: next three compositor sessions will be recorded (%s)\n' "$mode"
}

disarm() {
  rm -f "$state_root/armed"
  printf 'disarmed: no further milestones will be recorded\n'
}

begin() {
  local session="${1:-}" stamp="${2:-}"
  is_session "$session" || return 0
  valid_stamp "$stamp" || return 0
  [[ -e "$state_root/armed" ]] || return 0
  lock_campaign
  resolve_run "$session" true || return 0
  local run_dir="$REPLY"
  if ! same_boot "$run_dir"; then
    : >"$run_dir/boot-mismatch"
    return 0
  fi
  write_once "$run_dir/compositor-start" "$stamp"
  finish_if_complete
}

mark() {
  local session="${1:-}" marker="${2:-}" stamp="${3:-}"
  is_session "$session" || return 0
  is_marker "$marker" || return 0
  valid_stamp "$stamp" || return 0
  [[ -e "$state_root/armed" ]] || return 0
  lock_campaign
  resolve_run "$session" true || return 0
  local run_dir="$REPLY" start waybar_state
  if ! same_boot "$run_dir"; then
    : >"$run_dir/boot-mismatch"
    return 0
  fi
  if [[ "$marker" == "ags-component-host-main-complete" && "$(campaign_mode)" == "lazy-waybar" \
    && ! -e "$run_dir/waybar-at-ags-ready" ]]; then
    waybar_state="$(capture_waybar_state "$session")"
    write_once "$run_dir/waybar-at-ags-ready" "$waybar_state"
  fi
  [[ ! -e "$run_dir/$marker" ]] || return 0
  start="$(read_file "$run_dir/compositor-start" 2>/dev/null || true)"
  if [[ -n "$start" ]] && ! awk -v start="$start" -v now="$stamp" -v timeout="$capture_timeout_seconds" \
    'BEGIN { exit !(now - start <= timeout) }'; then
    : >"$run_dir/timed-out"
    return 0
  fi
  write_once "$run_dir/$marker" "$stamp"
  finish_if_complete
}

status() {
  local campaign mode run waybar_state
  campaign="$(campaign_dir 2>/dev/null || true)"
  if [[ -z "$campaign" ]]; then
    printf 'not armed; no current capture campaign\n'
    return 0
  fi
  mode="$(campaign_mode)"
  printf 'armed: %s\n' "$([[ -e "$state_root/armed" ]] && printf yes || printf no)"
  printf 'campaign: %s\n' "${campaign##*/}"
  printf 'mode: %s\n' "$mode"
  for run in "$campaign"/run-*; do
    [[ -d "$run" ]] || continue
    if [[ "$mode" == "lazy-waybar" ]]; then
      waybar_state="$(read_file "$run/waybar-at-ags-ready" 2>/dev/null || printf missing)"
      printf '%s: compositor=%s waybar-at-ags-ready=%s ags=%s\n' "${run##*/}" \
        "$([[ -f "$run/compositor-start" ]] && printf recorded || printf missing)" \
        "$waybar_state" \
        "$([[ -f "$run/ags-component-host-main-complete" ]] && printf recorded || printf missing)"
    else
      printf '%s: compositor=%s waybar=%s ags=%s\n' "${run##*/}" \
        "$([[ -f "$run/compositor-start" ]] && printf recorded || printf missing)" \
        "$([[ -f "$run/waybar-layer-mapped" ]] && printf recorded || printf missing)" \
        "$([[ -f "$run/ags-component-host-main-complete" ]] && printf recorded || printf missing)"
    fi
  done
}

marker_state() {
  [[ -n "$1" ]] && printf recorded || printf missing
}

milliseconds_between() {
  awk -v start="$1" -v end="$2" 'BEGIN { printf "%.0f", (end - start) * 1000 }'
}

summarize_values() {
  local label="$1"
  shift
  local values count median minimum maximum
  values="$(printf '%s\n' "$@" | sort -n)"
  count="$#"
  median="$(awk -v n="$count" 'NR == int((n + 1) / 2) { lower = $1 } NR == int((n + 2) / 2) { upper = $1 } END { printf "%.0f", (lower + upper) / 2 }' <<<"$values")"
  minimum="$(head -n 1 <<<"$values")"
  maximum="$(tail -n 1 <<<"$values")"
  printf '%s: median %s ms; range %s–%s ms (n=%s)\n' "$label" "$median" "$minimum" "$maximum" "$count"
}

report() {
  local campaign mode run start waybar ags waybar_state waybar_ms ags_ms
  campaign="$(campaign_dir 2>/dev/null || true)"
  [[ -n "$campaign" ]] || fail "no current capture campaign"
  mode="$(campaign_mode)"
  local -a complete_waybar=() complete_ags=()
  for run in "$campaign"/run-*; do
    [[ -d "$run" ]] || continue
    start="$(read_file "$run/compositor-start" 2>/dev/null || true)"
    waybar="$(read_file "$run/waybar-layer-mapped" 2>/dev/null || true)"
    ags="$(read_file "$run/ags-component-host-main-complete" 2>/dev/null || true)"
    waybar_state="$(read_file "$run/waybar-at-ags-ready" 2>/dev/null || true)"
    if [[ -e "$run/boot-mismatch" ]]; then
      printf '%s: boot identity changed; excluded\n' "${run##*/}"
      continue
    fi
    if [[ -e "$run/timed-out" ]]; then
      if [[ "$mode" == "lazy-waybar" ]]; then
        printf '%s: timed out after %s s (compositor=%s, waybar-at-ags-ready=%s, ags=%s)\n' \
          "${run##*/}" "$capture_timeout_seconds" "$(marker_state "$start")" \
          "${waybar_state:-missing}" "$(marker_state "$ags")"
      else
        printf '%s: timed out after %s s (compositor=%s, waybar=%s, ags=%s)\n' \
          "${run##*/}" "$capture_timeout_seconds" "$(marker_state "$start")" \
          "$(marker_state "$waybar")" "$(marker_state "$ags")"
      fi
      continue
    fi
    if [[ "$mode" == "lazy-waybar" ]]; then
      if [[ -z "$start" || -z "$ags" || -z "$waybar_state" ]]; then
        printf '%s: incomplete (compositor=%s, waybar-at-ags-ready=%s, ags=%s)\n' \
          "${run##*/}" "$(marker_state "$start")" "${waybar_state:-missing}" "$(marker_state "$ags")"
        continue
      fi
      if [[ "$waybar_state" != "absent" ]]; then
        printf '%s: Waybar state at AGS readiness was %s; excluded\n' "${run##*/}" "$waybar_state"
        continue
      fi
      if ! awk -v start="$start" -v ags="$ags" -v timeout="$capture_timeout_seconds" \
        'BEGIN { exit !(start <= ags && ags - start <= timeout) }'; then
        printf '%s: invalid monotonic ordering or duration; excluded\n' "${run##*/}"
        continue
      fi
      ags_ms="$(milliseconds_between "$start" "$ags")"
      printf '%s: Waybar absent at AGS readiness; AGS component-host main complete %s ms\n' \
        "${run##*/}" "$ags_ms"
      complete_ags+=("$ags_ms")
      continue
    fi
    if [[ -z "$start" || -z "$waybar" || -z "$ags" ]]; then
      printf '%s: incomplete (compositor=%s, waybar=%s, ags=%s)\n' "${run##*/}" \
        "$(marker_state "$start")" "$(marker_state "$waybar")" "$(marker_state "$ags")"
      continue
    fi
    if ! awk -v start="$start" -v waybar="$waybar" -v ags="$ags" -v timeout="$capture_timeout_seconds" \
      'BEGIN { exit !(start <= waybar && start <= ags && waybar - start <= timeout && ags - start <= timeout) }'; then
      printf '%s: invalid monotonic ordering or duration; excluded\n' "${run##*/}"
      continue
    fi
    waybar_ms="$(milliseconds_between "$start" "$waybar")"
    ags_ms="$(milliseconds_between "$start" "$ags")"
    printf '%s: Waybar layer mapped %s ms; AGS component-host main complete %s ms\n' \
      "${run##*/}" "$waybar_ms" "$ags_ms"
    complete_waybar+=("$waybar_ms")
    complete_ags+=("$ags_ms")
  done
  (( ${#complete_ags[@]} > 0 )) || { printf 'summary: no comparable complete runs\n'; return 0; }
  printf 'summary (complete runs only; clock resolution approximately 10 ms):\n'
  if [[ "$mode" == "lazy-waybar" ]]; then
    printf 'Waybar absent at AGS readiness: %s/%s complete runs\n' "${#complete_ags[@]}" "${#complete_ags[@]}"
  else
    summarize_values "Waybar layer mapped" "${complete_waybar[@]}"
  fi
  summarize_values "AGS component-host main complete" "${complete_ags[@]}"
}

case "${1:-}" in
  arm) arm "${2:-}" ;;
  disarm) disarm ;;
  begin) begin "${2:-}" "${3:-}" ;;
  mark) mark "${2:-}" "${3:-}" "${4:-}" ;;
  status) status ;;
  report) report ;;
  *) fail "usage: $0 {arm [eager|lazy-waybar]|disarm|status|report|begin SESSION TIMESTAMP|mark SESSION MARKER TIMESTAMP}" ;;
esac

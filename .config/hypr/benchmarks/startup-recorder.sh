#!/usr/bin/env bash

set -euo pipefail
umask 077

state_root="${HYPR_STARTUP_BENCHMARK_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/hypr-startup-benchmark}"
readonly state_root
readonly markers=(waybar-layer-mapped ags-component-host-main-complete)
readonly target_runs=3
readonly capture_timeout_seconds=120

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
  local run_dir="$1" start waybar ags
  [[ ! -e "$run_dir/boot-mismatch" && ! -e "$run_dir/timed-out" ]] || return 1
  start="$(read_file "$run_dir/compositor-start" 2>/dev/null || true)"
  waybar="$(read_file "$run_dir/waybar-layer-mapped" 2>/dev/null || true)"
  ags="$(read_file "$run_dir/ags-component-host-main-complete" 2>/dev/null || true)"
  [[ -n "$start" && -n "$waybar" && -n "$ags" ]] || return 1
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
  local current_session="${HYPRLAND_INSTANCE_SIGNATURE:-}"
  is_session "$current_session" || fail "arm must run inside a Hyprland session"
  local campaign
  campaign="$(date -u +%Y%m%dT%H%M%S.%NZ)-$(boot_id)"
  mkdir -p "$state_root/campaigns/$campaign/sessions"
  printf '%s\n' "$campaign" >"$state_root/current"
  {
    printf 'target_runs=%s\n' "$target_runs"
    printf 'clock=/proc/uptime (boot-relative, approximately 10 ms resolution)\n'
  } >"$state_root/campaigns/$campaign/metadata"
  printf '%s\n' "$current_session" >"$state_root/campaigns/$campaign/excluded-session"
  : >"$state_root/armed"
  printf 'armed: next three compositor sessions will be recorded\n'
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
  local run_dir="$REPLY" start
  if ! same_boot "$run_dir"; then
    : >"$run_dir/boot-mismatch"
    return 0
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
  local campaign
  campaign="$(campaign_dir 2>/dev/null || true)"
  if [[ -z "$campaign" ]]; then
    printf 'not armed; no current capture campaign\n'
    return 0
  fi
  printf 'armed: %s\n' "$([[ -e "$state_root/armed" ]] && printf yes || printf no)"
  printf 'campaign: %s\n' "${campaign##*/}"
  local run
  for run in "$campaign"/run-*; do
    [[ -d "$run" ]] || continue
    printf '%s: compositor=%s waybar=%s ags=%s\n' "${run##*/}" \
      "$([[ -f "$run/compositor-start" ]] && printf recorded || printf missing)" \
      "$([[ -f "$run/waybar-layer-mapped" ]] && printf recorded || printf missing)" \
      "$([[ -f "$run/ags-component-host-main-complete" ]] && printf recorded || printf missing)"
  done
}

marker_state() {
  [[ -n "$1" ]] && printf recorded || printf missing
}

milliseconds_between() {
  awk -v start="$1" -v end="$2" 'BEGIN { printf "%.0f", (end - start) * 1000 }'
}

report() {
  local campaign
  campaign="$(campaign_dir 2>/dev/null || true)"
  [[ -n "$campaign" ]] || fail "no current capture campaign"
  local -a complete=()
  local run start waybar ags
  for run in "$campaign"/run-*; do
    [[ -d "$run" ]] || continue
    start="$(read_file "$run/compositor-start" 2>/dev/null || true)"
    waybar="$(read_file "$run/waybar-layer-mapped" 2>/dev/null || true)"
    ags="$(read_file "$run/ags-component-host-main-complete" 2>/dev/null || true)"
    if [[ -e "$run/boot-mismatch" ]]; then
      printf '%s: boot identity changed; excluded\n' "${run##*/}"
      continue
    fi
    if [[ -e "$run/timed-out" ]]; then
      printf '%s: timed out after %s s (compositor=%s, waybar=%s, ags=%s)\n' "${run##*/}" "$capture_timeout_seconds" \
        "$(marker_state "$start")" "$(marker_state "$waybar")" "$(marker_state "$ags")"
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
    local waybar_ms ags_ms
    waybar_ms="$(milliseconds_between "$start" "$waybar")"
    ags_ms="$(milliseconds_between "$start" "$ags")"
    printf '%s: Waybar layer mapped %s ms; AGS component-host main complete %s ms\n' "${run##*/}" "$waybar_ms" "$ags_ms"
    complete+=("$waybar_ms,$ags_ms")
  done
  (( ${#complete[@]} > 0 )) || { printf 'summary: no comparable complete runs\n'; return 0; }
  printf 'summary (complete runs only; clock resolution approximately 10 ms):\n'
  local column
  for column in 1 2; do
    local label="Waybar layer mapped" values
    (( column == 2 )) && label="AGS component-host main complete"
    values="$(printf '%s\n' "${complete[@]}" | cut -d, -f"$column" | sort -n)"
    local count median minimum maximum
    count="$(wc -l <<<"$values")"
    median="$(awk -v n="$count" 'NR == int((n + 1) / 2) { lower = $1 } NR == int((n + 2) / 2) { upper = $1 } END { printf "%.0f", (lower + upper) / 2 }' <<<"$values")"
    minimum="$(head -n 1 <<<"$values")"
    maximum="$(tail -n 1 <<<"$values")"
    printf '%s: median %s ms; range %s–%s ms (n=%s)\n' "$label" "$median" "$minimum" "$maximum" "$count"
  done
}

case "${1:-}" in
  arm) arm ;;
  disarm) disarm ;;
  begin) begin "${2:-}" "${3:-}" ;;
  mark) mark "${2:-}" "${3:-}" "${4:-}" ;;
  status) status ;;
  report) report ;;
  *) fail "usage: $0 {arm|disarm|status|report|begin SESSION TIMESTAMP|mark SESSION MARKER TIMESTAMP}" ;;
esac

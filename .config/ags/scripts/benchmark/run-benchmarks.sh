#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGS_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

INSTANCE="ags-bundled"
COMPONENT="window-switcher"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp}"
PERF_FLAG="$RUNTIME_DIR/ags-benchmark-mode"
PERF_LOG="$RUNTIME_DIR/ags-performance.jsonl"
SUMMARY_OUT="$RUNTIME_DIR/ags-benchmark-summary.json"
EXTRAS_OUT="$RUNTIME_DIR/ags-benchmark-extras.json"
RUN_LOG="$RUNTIME_DIR/ags-benchmark-run.log"
BASELINE_PATH="${AGS_DIR}/benchmarks/baseline.json"
SYSTEM_GI_TYPELIB_PATH="/run/current-system/sw/lib/girepository-1.0"

BENCH_COLD="${BENCH_COLD:-0}"
BENCH_RESTART="${BENCH_RESTART:-0}"
BENCH_CYCLE_COUNT="${BENCH_CYCLE_COUNT:-10}"
BENCH_CYCLE_SLEEP="${BENCH_CYCLE_SLEEP:-0.05}"
BENCH_WARMUP_COUNT="${BENCH_WARMUP_COUNT:-2}"
BENCH_MEM_CYCLES="${BENCH_MEM_CYCLES:-100}"
BENCH_COMPONENT_CYCLES="${BENCH_COMPONENT_CYCLES:-25}"
BENCH_AUDIO_MIXER_SLEEP="${BENCH_AUDIO_MIXER_SLEEP:-0}"
BENCH_CALENDAR_CYCLES="${BENCH_CALENDAR_CYCLES:-12}"
BENCH_CALENDAR_REFRESH_WAIT="${BENCH_CALENDAR_REFRESH_WAIT:-0.25}"
BENCH_TARGET="${1:-${BENCH_TARGET:-all}}"

function target_enabled() {
  local target="$1"
  case "$BENCH_TARGET" in
    all)
      return 0
      ;;
    bundle-legacy)
      [[ "$target" == "window-switcher" || "$target" == "components" || "$target" == "memory" ]]
      ;;
    calendar | calendar-widget)
      [[ "$target" == "calendar-widget" ]]
      ;;
    window | window-switcher)
      [[ "$target" == "window-switcher" ]]
      ;;
    components)
      [[ "$target" == "components" || "$target" == "audio-mixer" ]]
      ;;
    audio-mixer)
      [[ "$target" == "audio-mixer" ]]
      ;;
    memory)
      [[ "$target" == "memory" ]]
      ;;
    *)
      printf "Unknown BENCH_TARGET: %s\n" "$BENCH_TARGET" >&2
      printf "Expected one of: all, calendar-widget, window-switcher, components, audio-mixer, memory, bundle-legacy\n" >&2
      exit 2
      ;;
  esac
}

function is_running() {
  ags list 2>/dev/null | grep -q "${INSTANCE}"
}

function wait_for_instance() {
  local tries=20
  for _ in $(seq 1 "$tries"); do
    if is_running && ags request -i "$INSTANCE" "" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

function request() {
  local payload="$1"
  ags request -i "$INSTANCE" "$COMPONENT" "$payload" >/dev/null
}

function request_component() {
  local component="$1"
  local payload="$2"
  ags request -i "$INSTANCE" "$component" "$payload" >/dev/null
}

function request_calendar() {
  local payload="$1"
  request_component "calendar-widget" "$payload"
}

function timed_calendar_request() {
  local payload="$1"
  local start_ns
  local end_ns
  start_ns="$(now_ns)"
  request_calendar "$payload"
  end_ns="$(now_ns)"
  ms_from_ns "$((end_ns - start_ns))"
}

function now_ns() {
  date +%s%N
}

function ms_from_ns() {
  local ns="$1"
  printf "%d" "$((ns / 1000000))"
}

function read_rss_kb() {
  local pid="$1"
  awk '/^VmRSS:/ {print $2; exit}' "/proc/${pid}/status" 2>/dev/null || echo ""
}

function read_pss_kb() {
  local pid="$1"
  awk '/^Pss:/ {print $2; exit}' "/proc/${pid}/smaps_rollup" 2>/dev/null || echo ""
}

function process_identity() {
  local pid="$1"
  awk -v pid="$pid" '{print pid ":" $22; exit}' "/proc/${pid}/stat" 2>/dev/null || echo ""
}

function read_combined_rss_kb() {
  local launcher_rss
  local gjs_rss
  assert_process_identity
  launcher_rss="$(read_rss_kb "$AGS_PID")"
  gjs_rss="$(read_rss_kb "$GJS_PID")"
  if ! is_number "$launcher_rss" || ! is_number "$gjs_rss"; then
    echo ""
    return
  fi
  printf "%s" "$((launcher_rss + gjs_rss))"
}

function read_combined_pss_kb() {
  local launcher_pss
  local gjs_pss
  assert_process_identity
  launcher_pss="$(read_pss_kb "$AGS_PID")"
  gjs_pss="$(read_pss_kb "$GJS_PID")"
  if ! is_number "$launcher_pss" || ! is_number "$gjs_pss"; then
    echo ""
    return
  fi
  printf "%s" "$((launcher_pss + gjs_pss))"
}

function read_scope_rss_kb() {
  local scope="$1"
  case "$scope" in
    launcher) read_rss_kb "$AGS_PID" ;;
    gjs) read_rss_kb "$GJS_PID" ;;
    combined) read_combined_rss_kb ;;
  esac
}

function read_scope_pss_kb() {
  local scope="$1"
  case "$scope" in
    launcher) read_pss_kb "$AGS_PID" ;;
    gjs) read_pss_kb "$GJS_PID" ;;
    combined) read_combined_pss_kb ;;
  esac
}

function scope_pid() {
  local scope="$1"
  case "$scope" in
    launcher) printf "%s" "$AGS_PID" ;;
    gjs) printf "%s" "$GJS_PID" ;;
    combined) printf -- "-" ;;
  esac
}

function assert_process_identity() {
  if [[ "$(process_identity "$AGS_PID")" != "$AGS_IDENTITY" ]]; then
    printf "AGS launcher changed during benchmark (expected %s)\n" "$AGS_IDENTITY" >&2
    exit 1
  fi
  if [[ "$(process_identity "$GJS_PID")" != "$GJS_IDENTITY" ]]; then
    printf "GJS process changed during benchmark (expected %s)\n" "$GJS_IDENTITY" >&2
    exit 1
  fi
}

function is_number() {
  [[ "$1" =~ ^-?[0-9]+$ ]]
}

function json_number_or_null() {
  local value="$1"
  if is_number "$value"; then
    printf "%s" "$value"
  else
    printf "null"
  fi
}

function memory_scope_json() {
  local scope="$1"
  local pid_json="$2"
  local identity="$3"
  cat <<EOF
{
      "pid": ${pid_json},
      "identity": "${identity}",
      "rss_kb": {
        "before": $(json_number_or_null "${memory_before_rss[$scope]}"),
        "avg": $(json_number_or_null "${memory_avg_rss[$scope]}"),
        "peak": $(json_number_or_null "${memory_peak_rss[$scope]}"),
        "after": $(json_number_or_null "${memory_after_rss[$scope]}"),
        "delta": $(json_number_or_null "${memory_delta_rss[$scope]}")
      },
      "pss_kb": {
        "before": $(json_number_or_null "${memory_before_pss[$scope]}"),
        "avg": $(json_number_or_null "${memory_avg_pss[$scope]}"),
        "peak": $(json_number_or_null "${memory_peak_pss[$scope]}"),
        "after": $(json_number_or_null "${memory_after_pss[$scope]}"),
        "delta": $(json_number_or_null "${memory_delta_pss[$scope]}")
      }
    }
EOF
}

STARTED_INSTANCE=0
AGS_PID=""
GJS_PID=""

if { [[ "$BENCH_COLD" == "1" ]] || [[ "$BENCH_RESTART" == "1" ]]; } && is_running; then
  ags quit -i "$INSTANCE" >/dev/null 2>&1 || true
  sleep 1
fi

if ! is_running; then
  if [[ -d "$SYSTEM_GI_TYPELIB_PATH" ]]; then
    export GI_TYPELIB_PATH="$SYSTEM_GI_TYPELIB_PATH${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}"
  fi
  (cd "$AGS_DIR" && exec ags run config-bundled.tsx) >"$RUN_LOG" 2>&1 &
  AGS_PID="$!"
  STARTED_INSTANCE=1
fi

if [[ -z "$AGS_PID" ]]; then
  AGS_PID="$(pgrep -f "ags run .*config-bundled.tsx" | head -n 1 || true)"
fi

if [[ -z "$AGS_PID" ]]; then
  AGS_PID="$(pgrep -f "ags.*${INSTANCE}" | head -n 1 || true)"
fi

if ! wait_for_instance; then
  printf "Failed to start %s\n" "$INSTANCE" >&2
  exit 1
fi

if [[ -z "$AGS_PID" || ! -r "/proc/${AGS_PID}/status" ]]; then
  AGS_PID="$(pgrep -f "ags run .*config-bundled.tsx" | head -n 1 || true)"
fi

if [[ -z "$AGS_PID" || ! -r "/proc/${AGS_PID}/status" ]]; then
  AGS_PID="$(pgrep -f "ags.*${INSTANCE}" | head -n 1 || true)"
fi

if [[ -n "$AGS_PID" ]]; then
  GJS_PID="$(pgrep -P "$AGS_PID" -x gjs || true)"
  GJS_PID="${GJS_PID%%$'\n'*}"
fi

if [[ -z "$GJS_PID" || ! -r "/proc/${GJS_PID}/status" ]]; then
  printf "Failed to resolve GJS child for AGS launcher PID %s\n" "${AGS_PID:-unknown}" >&2
  exit 1
fi

AGS_IDENTITY="$(process_identity "$AGS_PID")"
GJS_IDENTITY="$(process_identity "$GJS_PID")"
if [[ -z "$AGS_IDENTITY" || -z "$GJS_IDENTITY" ]]; then
  printf "Failed to capture stable AGS process identities\n" >&2
  exit 1
fi

rm -f "$PERF_LOG"
touch "$PERF_FLAG"

printf "AGS benchmark: %s target=%s\n" "$INSTANCE" "$BENCH_TARGET"

latency_ms=0
total_ms=0
avg_ms=0
calendar_cold_show_ms=0
calendar_warm_show_ms=0
calendar_next_avg_ms=0
calendar_prev_avg_ms=0
calendar_today_ms=0
calendar_before_rss_kb=""
calendar_after_rss_kb=""
calendar_delta_rss_kb=""
calendar_before_pss_kb=""
calendar_after_pss_kb=""
calendar_delta_pss_kb=""
calendar_enabled=false
sm_delta_rss_kb=""
sm_delta_pss_kb=""
vi_delta_rss_kb=""
vi_delta_pss_kb=""
ks_delta_rss_kb=""
ks_delta_pss_kb=""
dc_delta_rss_kb=""
dc_delta_pss_kb=""
am_delta_rss_kb=""
am_delta_pss_kb=""
before_rss_kb=""
after_rss_kb=""
delta_rss_kb=""
avg_rss_kb=""
rss_peak_kb=""
before_pss_kb=""
after_pss_kb=""
avg_pss_kb=""
pss_peak_kb=""
delta_pss_kb=""

if target_enabled "calendar-widget"; then
calendar_enabled=true
printf -- "%s\n" "- calendar-widget baseline (${BENCH_CALENDAR_CYCLES} nav cycles)"
calendar_before_rss_kb="$(read_combined_rss_kb)"
calendar_before_pss_kb="$(read_combined_pss_kb)"
request_calendar '{"action":"hide"}'
calendar_cold_show_ms="$(timed_calendar_request '{"action":"show"}')"
sleep "$BENCH_CALENDAR_REFRESH_WAIT"
request_calendar '{"action":"hide"}'
calendar_warm_show_ms="$(timed_calendar_request '{"action":"show"}')"
sleep "$BENCH_CALENDAR_REFRESH_WAIT"

calendar_next_total_ms=0
calendar_prev_total_ms=0
for _ in $(seq 1 "$BENCH_CALENDAR_CYCLES"); do
  nav_ms="$(timed_calendar_request '{"action":"next-month"}')"
  calendar_next_total_ms="$((calendar_next_total_ms + nav_ms))"
  sleep "$BENCH_CYCLE_SLEEP"
done
for _ in $(seq 1 "$BENCH_CALENDAR_CYCLES"); do
  nav_ms="$(timed_calendar_request '{"action":"prev-month"}')"
  calendar_prev_total_ms="$((calendar_prev_total_ms + nav_ms))"
  sleep "$BENCH_CYCLE_SLEEP"
done
calendar_today_ms="$(timed_calendar_request '{"action":"today"}')"
sleep "$BENCH_CALENDAR_REFRESH_WAIT"
request_calendar '{"action":"hide"}'
calendar_after_rss_kb="$(read_combined_rss_kb)"
calendar_after_pss_kb="$(read_combined_pss_kb)"
calendar_delta_rss_kb=""
calendar_delta_pss_kb=""
if is_number "$calendar_before_rss_kb" && is_number "$calendar_after_rss_kb"; then
  calendar_delta_rss_kb="$((calendar_after_rss_kb - calendar_before_rss_kb))"
fi
if is_number "$calendar_before_pss_kb" && is_number "$calendar_after_pss_kb"; then
  calendar_delta_pss_kb="$((calendar_after_pss_kb - calendar_before_pss_kb))"
fi
calendar_next_avg_ms="$((calendar_next_total_ms / BENCH_CALENDAR_CYCLES))"
calendar_prev_avg_ms="$((calendar_prev_total_ms / BENCH_CALENDAR_CYCLES))"
printf "  cold_show=%sms warm_show=%sms next_avg=%sms prev_avg=%sms today=%sms rss_delta=%sKB pss_delta=%sKB\n" \
  "$calendar_cold_show_ms" \
  "$calendar_warm_show_ms" \
  "$calendar_next_avg_ms" \
  "$calendar_prev_avg_ms" \
  "$calendar_today_ms" \
  "${calendar_delta_rss_kb:-}" \
  "${calendar_delta_pss_kb:-}"
else
  printf -- "%s\n" "- calendar-widget: skipped"
fi

if target_enabled "window-switcher"; then
for _ in $(seq 1 "$BENCH_WARMUP_COUNT"); do
  request '{"action":"get-mode"}'
done

printf -- "%s" "- warm show latency: "
start_ns="$(now_ns)"
request '{"action":"next"}'
end_ns="$(now_ns)"
request '{"action":"hide"}'
latency_ms="$(ms_from_ns "$((end_ns - start_ns))")"
printf "%sms\n" "$latency_ms"

printf -- "%s" "- cycle ${BENCH_CYCLE_COUNT} iterations: "
start_ns="$(now_ns)"
for _ in $(seq 1 "$BENCH_CYCLE_COUNT"); do
  request '{"action":"next"}'
  sleep "$BENCH_CYCLE_SLEEP"
done
end_ns="$(now_ns)"
request '{"action":"hide"}'
total_ms="$(ms_from_ns "$((end_ns - start_ns))")"
avg_ms="$((total_ms / BENCH_CYCLE_COUNT))"
printf "%sms avg\n" "$avg_ms"
else
  printf -- "%s\n" "- window-switcher: skipped"
fi

if target_enabled "components"; then
printf -- "%s\n" "- start-menu toggle (${BENCH_COMPONENT_CYCLES} cycles)"
sm_before_rss_kb="$(read_combined_rss_kb)"
sm_before_pss_kb="$(read_combined_pss_kb)"
for _ in $(seq 1 "$BENCH_COMPONENT_CYCLES"); do
  ags request -i "$INSTANCE" "start-menu" '{"action":"show"}' >/dev/null
  ags request -i "$INSTANCE" "start-menu" '{"action":"hide"}' >/dev/null
done
sm_after_rss_kb="$(read_combined_rss_kb)"
sm_after_pss_kb="$(read_combined_pss_kb)"
sm_delta_rss_kb=""
sm_delta_pss_kb=""
if is_number "$sm_before_rss_kb" && is_number "$sm_after_rss_kb"; then
  sm_delta_rss_kb="$((sm_after_rss_kb - sm_before_rss_kb))"
fi
if is_number "$sm_before_pss_kb" && is_number "$sm_after_pss_kb"; then
  sm_delta_pss_kb="$((sm_after_pss_kb - sm_before_pss_kb))"
fi

printf -- "%s\n" "- volume-indicator show (${BENCH_COMPONENT_CYCLES} cycles)"
vi_before_rss_kb="$(read_combined_rss_kb)"
vi_before_pss_kb="$(read_combined_pss_kb)"
for _ in $(seq 1 "$BENCH_COMPONENT_CYCLES"); do
  ags request -i "$INSTANCE" "volume-indicator" '{"action":"show"}' >/dev/null
  ags request -i "$INSTANCE" "volume-indicator" '{"action":"hide"}' >/dev/null
done
vi_after_rss_kb="$(read_combined_rss_kb)"
vi_after_pss_kb="$(read_combined_pss_kb)"
vi_delta_rss_kb=""
vi_delta_pss_kb=""
if is_number "$vi_before_rss_kb" && is_number "$vi_after_rss_kb"; then
  vi_delta_rss_kb="$((vi_after_rss_kb - vi_before_rss_kb))"
fi
if is_number "$vi_before_pss_kb" && is_number "$vi_after_pss_kb"; then
  vi_delta_pss_kb="$((vi_after_pss_kb - vi_before_pss_kb))"
fi

printf -- "%s\n" "- keyboard-switcher show (${BENCH_COMPONENT_CYCLES} cycles)"
ks_before_rss_kb="$(read_combined_rss_kb)"
ks_before_pss_kb="$(read_combined_pss_kb)"
for i in $(seq 1 "$BENCH_COMPONENT_CYCLES"); do
  active="EN"
  if [[ "$((i % 2))" -eq 0 ]]; then
    active="DA"
  fi
  ags request -i "$INSTANCE" "keyboard-switcher" "{\"action\":\"show\",\"config\":{\"layouts\":[\"EN\",\"DA\"],\"activeLayout\":\"${active}\",\"size\":\"sm\"}}" >/dev/null
  ags request -i "$INSTANCE" "keyboard-switcher" '{"action":"hide"}' >/dev/null
done
ks_after_rss_kb="$(read_combined_rss_kb)"
ks_after_pss_kb="$(read_combined_pss_kb)"
ks_delta_rss_kb=""
ks_delta_pss_kb=""
if is_number "$ks_before_rss_kb" && is_number "$ks_after_rss_kb"; then
  ks_delta_rss_kb="$((ks_after_rss_kb - ks_before_rss_kb))"
fi
if is_number "$ks_before_pss_kb" && is_number "$ks_after_pss_kb"; then
  ks_delta_pss_kb="$((ks_after_pss_kb - ks_before_pss_kb))"
fi

printf -- "%s\n" "- desktop-clock show (${BENCH_COMPONENT_CYCLES} cycles)"
dc_before_rss_kb="$(read_combined_rss_kb)"
dc_before_pss_kb="$(read_combined_pss_kb)"
for i in $(seq 1 "$BENCH_COMPONENT_CYCLES"); do
  show_date="false"
  if [[ "$((i % 2))" -eq 0 ]]; then
    show_date="true"
  fi
  ags request -i "$INSTANCE" "desktop-clock" "{\"action\":\"config\",\"config\":{\"showDate\":${show_date}}}" >/dev/null
  ags request -i "$INSTANCE" "desktop-clock" '{"action":"show"}' >/dev/null
  ags request -i "$INSTANCE" "desktop-clock" '{"action":"hide"}' >/dev/null
done
dc_after_rss_kb="$(read_combined_rss_kb)"
dc_after_pss_kb="$(read_combined_pss_kb)"
dc_delta_rss_kb=""
dc_delta_pss_kb=""
if is_number "$dc_before_rss_kb" && is_number "$dc_after_rss_kb"; then
  dc_delta_rss_kb="$((dc_after_rss_kb - dc_before_rss_kb))"
fi
if is_number "$dc_before_pss_kb" && is_number "$dc_after_pss_kb"; then
  dc_delta_pss_kb="$((dc_after_pss_kb - dc_before_pss_kb))"
fi
else
  printf -- "%s\n" "- bundled components: skipped"
fi

if target_enabled "audio-mixer"; then
printf -- "%s\n" "- audio-mixer toggle (${BENCH_COMPONENT_CYCLES} cycles)"
am_before_rss_kb="$(read_combined_rss_kb)"
am_before_pss_kb="$(read_combined_pss_kb)"
for _ in $(seq 1 "$BENCH_COMPONENT_CYCLES"); do
  ags request -i "$INSTANCE" "audio-mixer-widget" '{"action":"show"}' >/dev/null
  ags request -i "$INSTANCE" "audio-mixer-widget" '{"action":"hide"}' >/dev/null
  sleep "$BENCH_AUDIO_MIXER_SLEEP"
done
am_after_rss_kb="$(read_combined_rss_kb)"
am_after_pss_kb="$(read_combined_pss_kb)"
am_delta_rss_kb=""
am_delta_pss_kb=""
if is_number "$am_before_rss_kb" && is_number "$am_after_rss_kb"; then
  am_delta_rss_kb="$((am_after_rss_kb - am_before_rss_kb))"
fi
if is_number "$am_before_pss_kb" && is_number "$am_after_pss_kb"; then
  am_delta_pss_kb="$((am_after_pss_kb - am_before_pss_kb))"
fi
else
  printf -- "%s\n" "- audio-mixer: skipped"
fi

MEMORY_SCOPES=(launcher gjs combined)
declare -A memory_before_rss memory_after_rss memory_delta_rss memory_sum_rss memory_peak_rss memory_samples_rss memory_avg_rss
declare -A memory_before_pss memory_after_pss memory_delta_pss memory_sum_pss memory_peak_pss memory_samples_pss memory_avg_pss

for scope in "${MEMORY_SCOPES[@]}"; do
  memory_before_rss[$scope]=""
  memory_after_rss[$scope]=""
  memory_delta_rss[$scope]=""
  memory_sum_rss[$scope]=0
  memory_peak_rss[$scope]=""
  memory_samples_rss[$scope]=0
  memory_avg_rss[$scope]=""
  memory_before_pss[$scope]=""
  memory_after_pss[$scope]=""
  memory_delta_pss[$scope]=""
  memory_sum_pss[$scope]=0
  memory_peak_pss[$scope]=""
  memory_samples_pss[$scope]=0
  memory_avg_pss[$scope]=""
done

if target_enabled "memory"; then
  assert_process_identity
  printf -- "%s\n" "- memory process tree over ${BENCH_MEM_CYCLES} cycles"
  for scope in "${MEMORY_SCOPES[@]}"; do
    memory_before_rss[$scope]="$(read_scope_rss_kb "$scope")"
    memory_before_pss[$scope]="$(read_scope_pss_kb "$scope")"
  done

  for _ in $(seq 1 "$BENCH_MEM_CYCLES"); do
    request '{"action":"next"}'
    request '{"action":"hide"}'
    assert_process_identity
    for scope in "${MEMORY_SCOPES[@]}"; do
      sample_rss="$(read_scope_rss_kb "$scope")"
      if is_number "$sample_rss"; then
        memory_sum_rss[$scope]="$((memory_sum_rss[$scope] + sample_rss))"
        memory_samples_rss[$scope]="$((memory_samples_rss[$scope] + 1))"
        if ! is_number "${memory_peak_rss[$scope]}" || [[ "$sample_rss" -gt "${memory_peak_rss[$scope]}" ]]; then
          memory_peak_rss[$scope]="$sample_rss"
        fi
      fi
      sample_pss="$(read_scope_pss_kb "$scope")"
      if is_number "$sample_pss"; then
        memory_sum_pss[$scope]="$((memory_sum_pss[$scope] + sample_pss))"
        memory_samples_pss[$scope]="$((memory_samples_pss[$scope] + 1))"
        if ! is_number "${memory_peak_pss[$scope]}" || [[ "$sample_pss" -gt "${memory_peak_pss[$scope]}" ]]; then
          memory_peak_pss[$scope]="$sample_pss"
        fi
      fi
    done
  done

  assert_process_identity
  for scope in "${MEMORY_SCOPES[@]}"; do
    memory_after_rss[$scope]="$(read_scope_rss_kb "$scope")"
    memory_after_pss[$scope]="$(read_scope_pss_kb "$scope")"
    if is_number "${memory_before_rss[$scope]}" && is_number "${memory_after_rss[$scope]}"; then
      memory_delta_rss[$scope]="$((memory_after_rss[$scope] - memory_before_rss[$scope]))"
    fi
    if is_number "${memory_before_pss[$scope]}" && is_number "${memory_after_pss[$scope]}"; then
      memory_delta_pss[$scope]="$((memory_after_pss[$scope] - memory_before_pss[$scope]))"
    fi
    if [[ "${memory_samples_rss[$scope]}" -gt 0 ]]; then
      memory_avg_rss[$scope]="$((memory_sum_rss[$scope] / memory_samples_rss[$scope]))"
    fi
    if [[ "${memory_samples_pss[$scope]}" -gt 0 ]]; then
      memory_avg_pss[$scope]="$((memory_sum_pss[$scope] / memory_samples_pss[$scope]))"
    fi
    printf "  %s pid=%s rss avg=%sKB peak=%sKB delta=%sKB pss avg=%sKB peak=%sKB delta=%sKB\n" \
      "$scope" "$(scope_pid "$scope")" \
      "${memory_avg_rss[$scope]}" "${memory_peak_rss[$scope]}" "${memory_delta_rss[$scope]}" \
      "${memory_avg_pss[$scope]}" "${memory_peak_pss[$scope]}" "${memory_delta_pss[$scope]}"
  done

  before_rss_kb="${memory_before_rss[combined]}"
  after_rss_kb="${memory_after_rss[combined]}"
  delta_rss_kb="${memory_delta_rss[combined]}"
  avg_rss_kb="${memory_avg_rss[combined]}"
  rss_peak_kb="${memory_peak_rss[combined]}"
  before_pss_kb="${memory_before_pss[combined]}"
  after_pss_kb="${memory_after_pss[combined]}"
  delta_pss_kb="${memory_delta_pss[combined]}"
  avg_pss_kb="${memory_avg_pss[combined]}"
  pss_peak_kb="${memory_peak_pss[combined]}"
else
  printf -- "%s\n" "- memory: skipped"
fi

before_rss_json="$(json_number_or_null "$before_rss_kb")"
after_rss_json="$(json_number_or_null "$after_rss_kb")"
delta_rss_json="$(json_number_or_null "$delta_rss_kb")"
avg_rss_json="$(json_number_or_null "$avg_rss_kb")"
peak_rss_json="$(json_number_or_null "$rss_peak_kb")"
before_pss_json="$(json_number_or_null "$before_pss_kb")"
after_pss_json="$(json_number_or_null "$after_pss_kb")"
delta_pss_json="$(json_number_or_null "$delta_pss_kb")"
avg_pss_json="$(json_number_or_null "$avg_pss_kb")"
peak_pss_json="$(json_number_or_null "$pss_peak_kb")"
launcher_memory_json="$(memory_scope_json launcher "$AGS_PID" "$AGS_IDENTITY")"
gjs_memory_json="$(memory_scope_json gjs "$GJS_PID" "$GJS_IDENTITY")"
combined_memory_json="$(memory_scope_json combined null "${AGS_IDENTITY}+${GJS_IDENTITY}")"
sm_delta_rss_json="$(json_number_or_null "$sm_delta_rss_kb")"
sm_delta_pss_json="$(json_number_or_null "$sm_delta_pss_kb")"
vi_delta_rss_json="$(json_number_or_null "$vi_delta_rss_kb")"
vi_delta_pss_json="$(json_number_or_null "$vi_delta_pss_kb")"
ks_delta_rss_json="$(json_number_or_null "$ks_delta_rss_kb")"
ks_delta_pss_json="$(json_number_or_null "$ks_delta_pss_kb")"
dc_delta_rss_json="$(json_number_or_null "$dc_delta_rss_kb")"
dc_delta_pss_json="$(json_number_or_null "$dc_delta_pss_kb")"
am_delta_rss_json="$(json_number_or_null "$am_delta_rss_kb")"
am_delta_pss_json="$(json_number_or_null "$am_delta_pss_kb")"
calendar_before_rss_json="$(json_number_or_null "$calendar_before_rss_kb")"
calendar_after_rss_json="$(json_number_or_null "$calendar_after_rss_kb")"
calendar_delta_rss_json="$(json_number_or_null "$calendar_delta_rss_kb")"
calendar_before_pss_json="$(json_number_or_null "$calendar_before_pss_kb")"
calendar_after_pss_json="$(json_number_or_null "$calendar_after_pss_kb")"
calendar_delta_pss_json="$(json_number_or_null "$calendar_delta_pss_kb")"

cat > "$EXTRAS_OUT" <<EOF
{
  "target": "${BENCH_TARGET}",
  "warm_show_ms": ${latency_ms},
  "cycle_total_ms": ${total_ms},
  "cycle_avg_ms": ${avg_ms},
  "calendar_widget": {
    "enabled": ${calendar_enabled},
    "cold_show_ms": ${calendar_cold_show_ms},
    "warm_show_ms": ${calendar_warm_show_ms},
    "next_month_avg_ms": ${calendar_next_avg_ms},
    "prev_month_avg_ms": ${calendar_prev_avg_ms},
    "today_ms": ${calendar_today_ms},
    "nav_cycles": ${BENCH_CALENDAR_CYCLES},
    "refresh_wait_seconds": ${BENCH_CALENDAR_REFRESH_WAIT},
    "memory_rss_kb": {
      "before": ${calendar_before_rss_json},
      "after": ${calendar_after_rss_json},
      "delta": ${calendar_delta_rss_json}
    },
    "memory_pss_kb": {
      "before": ${calendar_before_pss_json},
      "after": ${calendar_after_pss_json},
      "delta": ${calendar_delta_pss_json}
    }
  },
  "memory_rss_kb": {
    "before": ${before_rss_json},
    "after": ${after_rss_json},
    "delta": ${delta_rss_json},
    "avg": ${avg_rss_json},
    "peak": ${peak_rss_json}
  },
  "memory_pss_kb": {
    "before": ${before_pss_json},
    "after": ${after_pss_json},
    "delta": ${delta_pss_json},
    "avg": ${avg_pss_json},
    "peak": ${peak_pss_json}
  },
  "memory_processes": {
    "launcher": ${launcher_memory_json},
    "gjs": ${gjs_memory_json},
    "combined": ${combined_memory_json}
  },
  "component_memory_delta_kb": {
    "start-menu": {
      "rss": ${sm_delta_rss_json},
      "pss": ${sm_delta_pss_json}
    },
    "volume-indicator": {
      "rss": ${vi_delta_rss_json},
      "pss": ${vi_delta_pss_json}
    },
    "keyboard-switcher": {
      "rss": ${ks_delta_rss_json},
      "pss": ${ks_delta_pss_json}
    },
    "desktop-clock": {
      "rss": ${dc_delta_rss_json},
      "pss": ${dc_delta_pss_json}
    },
    "audio-mixer-widget": {
      "rss": ${am_delta_rss_json},
      "pss": ${am_delta_pss_json}
    }
  }
}
EOF

python3 "${SCRIPT_DIR}/analyze-results.py" --input "$PERF_LOG" --output "$SUMMARY_OUT" --baseline "$BASELINE_PATH" --extras "$EXTRAS_OUT"

rm -f "$PERF_FLAG"

if [[ "$STARTED_INSTANCE" == "1" ]]; then
  ags quit -i "$INSTANCE" >/dev/null 2>&1 || true
fi

printf "Results: %s\n" "$SUMMARY_OUT"

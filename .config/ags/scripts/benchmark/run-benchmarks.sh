#!/usr/bin/env bash
# Computed repository paths are linted independently by the benchmark globs.
# shellcheck disable=SC1091

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
BUNDLED_EXECUTABLE="$RUNTIME_DIR/ags-bundled-executable"
BUNDLED_START_LOCK="$RUNTIME_DIR/ags-bundled-start.lock"
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
BENCH_LAUNCHER_PID="${BENCH_LAUNCHER_PID:-}"
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

function scope_pid() {
  local scope="$1"
  case "$scope" in
    launcher) printf "%s" "$AGS_PID" ;;
    gjs) printf "%s" "$GJS_PID" ;;
    combined) printf -- "-" ;;
  esac
}

function assert_process_identity() {
  local current_gjs_pids=()
  if [[ "$(process_identity "$AGS_PID")" != "$AGS_IDENTITY" ]]; then
    printf "AGS launcher changed during benchmark (expected %s)\n" "$AGS_IDENTITY" >&2
    exit 1
  fi
  mapfile -t current_gjs_pids < <(pgrep -P "$AGS_PID" -x gjs || true)
  if [[ "${#current_gjs_pids[@]}" -ne 1 || "${current_gjs_pids[0]:-}" != "$GJS_PID" ]]; then
    printf "AGS launcher GJS child changed during benchmark (expected PID %s)\n" "$GJS_PID" >&2
    exit 1
  fi
  if [[ "$(process_identity "$GJS_PID")" != "$GJS_IDENTITY" ]]; then
    printf "GJS process changed during benchmark (expected %s)\n" "$GJS_IDENTITY" >&2
    exit 1
  fi
}

function capture_memory_sample() {
  assert_process_identity
  SAMPLE_LAUNCHER_RSS="$(read_rss_kb "$AGS_PID")"
  SAMPLE_GJS_RSS="$(read_rss_kb "$GJS_PID")"
  SAMPLE_LAUNCHER_PSS="$(read_pss_kb "$AGS_PID")"
  SAMPLE_GJS_PSS="$(read_pss_kb "$GJS_PID")"
  SAMPLE_COMBINED_RSS=""
  SAMPLE_COMBINED_PSS=""
  if is_number "$SAMPLE_LAUNCHER_RSS" && is_number "$SAMPLE_GJS_RSS"; then
    SAMPLE_COMBINED_RSS="$((SAMPLE_LAUNCHER_RSS + SAMPLE_GJS_RSS))"
  fi
  if is_number "$SAMPLE_LAUNCHER_PSS" && is_number "$SAMPLE_GJS_PSS"; then
    SAMPLE_COMBINED_PSS="$((SAMPLE_LAUNCHER_PSS + SAMPLE_GJS_PSS))"
  fi
}

function sample_scope_rss_kb() {
  local scope="$1"
  case "$scope" in
    launcher) printf "%s" "$SAMPLE_LAUNCHER_RSS" ;;
    gjs) printf "%s" "$SAMPLE_GJS_RSS" ;;
    combined) printf "%s" "$SAMPLE_COMBINED_RSS" ;;
  esac
}

function sample_scope_pss_kb() {
  local scope="$1"
  case "$scope" in
    launcher) printf "%s" "$SAMPLE_LAUNCHER_PSS" ;;
    gjs) printf "%s" "$SAMPLE_GJS_PSS" ;;
    combined) printf "%s" "$SAMPLE_COMBINED_PSS" ;;
  esac
}

function stop_owned_process() {
  local pid="$1"
  local identity="$2"
  if [[ -z "$identity" ]]; then
    wait "$pid" 2>/dev/null || true
    return
  fi
  for _ in $(seq 1 10); do
    if [[ "$(process_identity "$pid")" != "$identity" ]]; then
      wait "$pid" 2>/dev/null || true
      return
    fi
    sleep 0.1
  done
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do
    if [[ "$(process_identity "$pid")" != "$identity" ]]; then
      wait "$pid" 2>/dev/null || true
      return
    fi
    sleep 0.1
  done
  if [[ "$(process_identity "$pid")" == "$identity" ]]; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
  wait "$pid" 2>/dev/null || true
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

# Populated by the sourced process-memory benchmark before serialization.
# shellcheck disable=SC2154
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

source "$SCRIPT_DIR/lib/component-memory.sh"
source "$AGS_DIR/components/audio-mixer/__benchmarks__/toggle-memory.sh"
source "$AGS_DIR/components/calendar/__benchmarks__/calendar-widget.sh"
source "$AGS_DIR/components/desktop-clock/__benchmarks__/toggle-memory.sh"
source "$AGS_DIR/components/keyboard-switcher/__benchmarks__/toggle-memory.sh"
source "$AGS_DIR/components/start-menu/__benchmarks__/toggle-memory.sh"
source "$AGS_DIR/components/volume-indicator/__benchmarks__/toggle-memory.sh"
source "$AGS_DIR/components/window-switcher/__benchmarks__/window-switcher.sh"
source "$SCRIPT_DIR/bundled-memory.sh"

STARTED_INSTANCE=0
STARTED_IDENTITY=""
START_LOCK_FD=""
AGS_PID="$BENCH_LAUNCHER_PID"
GJS_PID=""

function cleanup() {
  local status=$?
  trap - EXIT
  rm -f "$PERF_FLAG"
  if [[ "$STARTED_INSTANCE" == "1" ]]; then
    ags quit -i "$INSTANCE" >/dev/null 2>&1 || true
    stop_owned_process "$AGS_PID" "$STARTED_IDENTITY"
  fi
  exit "$status"
}

trap cleanup EXIT

if { [[ "$BENCH_COLD" == "1" ]] || [[ "$BENCH_RESTART" == "1" ]]; } && is_running; then
  ags quit -i "$INSTANCE" >/dev/null 2>&1 || true
  sleep 1
fi

if ! is_running; then
  exec {START_LOCK_FD}>"$BUNDLED_START_LOCK"
  if ! flock -w 10 "$START_LOCK_FD"; then
    printf "Timed out waiting for bundled AGS startup lock\n" >&2
    exit 1
  fi
fi

if ! is_running; then
  if [[ -d "$SYSTEM_GI_TYPELIB_PATH" ]]; then
    export GI_TYPELIB_PATH="$SYSTEM_GI_TYPELIB_PATH${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}"
  fi
  if command -v ags-bundle-runtime >/dev/null 2>&1; then
    bundled_candidate="$BUNDLED_EXECUTABLE.$$"
    if ! (cd "$AGS_DIR" && ags bundle config-bundled.tsx "$bundled_candidate") >"$RUN_LOG" 2>&1; then
      rm -f "$bundled_candidate"
      printf "Failed to build bundled AGS executable\n" >&2
      exit 1
    fi
    mv -f "$bundled_candidate" "$BUNDLED_EXECUTABLE"
    ags-bundle-runtime "$BUNDLED_EXECUTABLE" >>"$RUN_LOG" 2>&1 &
  else
    # compatibility: remove after ags-bundle-runtime is deployed on every host.
    (cd "$AGS_DIR" && exec ags run config-bundled.tsx) >"$RUN_LOG" 2>&1 &
  fi
  AGS_PID="$!"
  STARTED_IDENTITY="$(process_identity "$AGS_PID")"
  STARTED_INSTANCE=1
fi

if [[ -z "$AGS_PID" ]]; then
  AGS_PID="$(pgrep -f "$BUNDLED_EXECUTABLE" | head -n 1 || true)"
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

if [[ -n "$START_LOCK_FD" ]]; then
  flock -u "$START_LOCK_FD"
  exec {START_LOCK_FD}>&-
  START_LOCK_FD=""
fi

if [[ -n "$BENCH_LAUNCHER_PID" && ! -r "/proc/${BENCH_LAUNCHER_PID}/status" ]]; then
  printf "Configured benchmark launcher PID is not running: %s\n" "$BENCH_LAUNCHER_PID" >&2
  exit 1
fi

if [[ -z "$AGS_PID" || ! -r "/proc/${AGS_PID}/status" ]]; then
  AGS_PID="$(pgrep -f "$BUNDLED_EXECUTABLE" | head -n 1 || true)"
fi

if [[ -z "$AGS_PID" || ! -r "/proc/${AGS_PID}/status" ]]; then
  AGS_PID="$(pgrep -f "ags run .*config-bundled.tsx" | head -n 1 || true)"
fi

if [[ -z "$AGS_PID" || ! -r "/proc/${AGS_PID}/status" ]]; then
  AGS_PID="$(pgrep -f "ags.*${INSTANCE}" | head -n 1 || true)"
fi

GJS_PIDS=()
if [[ -n "$AGS_PID" ]]; then
  mapfile -t GJS_PIDS < <(pgrep -P "$AGS_PID" -x gjs || true)
fi

if [[ "${#GJS_PIDS[@]}" -ne 1 || ! -r "/proc/${GJS_PIDS[0]:-}/status" ]]; then
  printf "Failed to resolve GJS child for AGS launcher PID %s\n" "${AGS_PID:-unknown}" >&2
  exit 1
fi
GJS_PID="${GJS_PIDS[0]}"

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

run_calendar_widget_benchmark
run_window_switcher_benchmark

if target_enabled "components"; then
  run_start_menu_benchmark
  run_volume_indicator_benchmark
  run_keyboard_switcher_benchmark
  run_desktop_clock_benchmark
else
  printf -- "%s\n" "- bundled components: skipped"
fi

run_audio_mixer_benchmark

run_bundled_memory_benchmark

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

printf "Results: %s\n" "$SUMMARY_OUT"

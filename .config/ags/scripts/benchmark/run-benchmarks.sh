#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGS_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

INSTANCE="ags-bundled"
COMPONENT="window-switcher"
PERF_FLAG="/tmp/ags-benchmark-mode"
PERF_LOG="/tmp/ags-performance.jsonl"
SUMMARY_OUT="/tmp/ags-benchmark-summary.json"
BASELINE_PATH="${AGS_DIR}/benchmarks/baseline.json"

BENCH_COLD="${BENCH_COLD:-0}"
BENCH_CYCLE_COUNT="${BENCH_CYCLE_COUNT:-10}"
BENCH_CYCLE_SLEEP="${BENCH_CYCLE_SLEEP:-0.05}"
BENCH_WARMUP_COUNT="${BENCH_WARMUP_COUNT:-2}"
BENCH_MEM_CYCLES="${BENCH_MEM_CYCLES:-100}"

function is_running() {
  ags list 2>/dev/null | grep -q "${INSTANCE}"
}

function wait_for_instance() {
  local tries=20
  for _ in $(seq 1 "$tries"); do
    if is_running; then
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

function now_ns() {
  date +%s%N
}

function ms_from_ns() {
  local ns="$1"
  printf "%d" "$((ns / 1000000))"
}

STARTED_INSTANCE=0
AGS_PID=""

if [[ "$BENCH_COLD" == "1" ]] && is_running; then
  ags quit "$INSTANCE" >/dev/null 2>&1 || true
  sleep 1
fi

if ! is_running; then
  ags run "${AGS_DIR}/config-bundled.tsx" >/tmp/ags-benchmark-run.log 2>&1 &
  AGS_PID="$!"
  STARTED_INSTANCE=1
fi

if ! wait_for_instance; then
  printf "Failed to start %s\n" "$INSTANCE" >&2
  exit 1
fi

rm -f "$PERF_LOG"
touch "$PERF_FLAG"

printf "AGS benchmark: %s\n" "$INSTANCE"

for _ in $(seq 1 "$BENCH_WARMUP_COUNT"); do
  request '{"action":"get-mode"}'
done

printf "- warm show latency: "
start_ns="$(now_ns)"
request '{"action":"next"}'
end_ns="$(now_ns)"
request '{"action":"hide"}'
latency_ms="$(ms_from_ns "$((end_ns - start_ns))")"
printf "%sms\n" "$latency_ms"

printf "- cycle %s iterations: " "$BENCH_CYCLE_COUNT"
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

if [[ -n "$AGS_PID" ]] && [[ -r "/proc/${AGS_PID}/status" ]]; then
  printf "- memory delta (%s cycles): " "$BENCH_MEM_CYCLES"
  before_kb="$(grep VmRSS "/proc/${AGS_PID}/status" | awk '{print $2}')"
  for _ in $(seq 1 "$BENCH_MEM_CYCLES"); do
    request '{"action":"next"}'
    request '{"action":"hide"}'
  done
  after_kb="$(grep VmRSS "/proc/${AGS_PID}/status" | awk '{print $2}')"
  delta_kb="$((after_kb - before_kb))"
  printf "%sKB\n" "$delta_kb"
else
  printf "- memory delta: skipped (no pid)\n"
fi

python3 "${SCRIPT_DIR}/analyze-results.py" --input "$PERF_LOG" --output "$SUMMARY_OUT" --baseline "$BASELINE_PATH"

rm -f "$PERF_FLAG"

if [[ "$STARTED_INSTANCE" == "1" ]]; then
  ags quit "$INSTANCE" >/dev/null 2>&1 || true
fi

printf "Results: %s\n" "$SUMMARY_OUT"

#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGS_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

INSTANCE="ags-bundled"
COMPONENT="window-switcher"
PERF_FLAG="/tmp/ags-benchmark-mode"
PERF_LOG="/tmp/ags-performance.jsonl"
SUMMARY_OUT="/tmp/ags-benchmark-summary.json"
EXTRAS_OUT="/tmp/ags-benchmark-extras.json"
BASELINE_PATH="${AGS_DIR}/benchmarks/baseline.json"

BENCH_COLD="${BENCH_COLD:-0}"
BENCH_RESTART="${BENCH_RESTART:-0}"
BENCH_CYCLE_COUNT="${BENCH_CYCLE_COUNT:-10}"
BENCH_CYCLE_SLEEP="${BENCH_CYCLE_SLEEP:-0.05}"
BENCH_WARMUP_COUNT="${BENCH_WARMUP_COUNT:-2}"
BENCH_MEM_CYCLES="${BENCH_MEM_CYCLES:-100}"
BENCH_COMPONENT_CYCLES="${BENCH_COMPONENT_CYCLES:-25}"

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

function read_rss_kb() {
  local pid="$1"
  awk '/^VmRSS:/ {print $2; exit}' "/proc/${pid}/status" 2>/dev/null || echo ""
}

function read_pss_kb() {
  local pid="$1"
  awk '/^Pss:/ {print $2; exit}' "/proc/${pid}/smaps_rollup" 2>/dev/null || echo ""
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

STARTED_INSTANCE=0
AGS_PID=""

if ([[ "$BENCH_COLD" == "1" ]] || [[ "$BENCH_RESTART" == "1" ]]) && is_running; then
  ags quit "$INSTANCE" >/dev/null 2>&1 || true
  sleep 1
fi

if ! is_running; then
  ags run "${AGS_DIR}/config-bundled.tsx" >/tmp/ags-benchmark-run.log 2>&1 &
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

rm -f "$PERF_LOG"
touch "$PERF_FLAG"

printf "AGS benchmark: %s\n" "$INSTANCE"

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

printf -- "%s\n" "- start-menu toggle (${BENCH_COMPONENT_CYCLES} cycles)"
sm_before_rss_kb="$(read_rss_kb "$AGS_PID")"
sm_before_pss_kb="$(read_pss_kb "$AGS_PID")"
for _ in $(seq 1 "$BENCH_COMPONENT_CYCLES"); do
  ags request -i "$INSTANCE" "start-menu" '{"action":"show"}' >/dev/null
  ags request -i "$INSTANCE" "start-menu" '{"action":"hide"}' >/dev/null
done
sm_after_rss_kb="$(read_rss_kb "$AGS_PID")"
sm_after_pss_kb="$(read_pss_kb "$AGS_PID")"
sm_delta_rss_kb=""
sm_delta_pss_kb=""
if is_number "$sm_before_rss_kb" && is_number "$sm_after_rss_kb"; then
  sm_delta_rss_kb="$((sm_after_rss_kb - sm_before_rss_kb))"
fi
if is_number "$sm_before_pss_kb" && is_number "$sm_after_pss_kb"; then
  sm_delta_pss_kb="$((sm_after_pss_kb - sm_before_pss_kb))"
fi

printf -- "%s\n" "- volume-indicator show (${BENCH_COMPONENT_CYCLES} cycles)"
vi_before_rss_kb="$(read_rss_kb "$AGS_PID")"
vi_before_pss_kb="$(read_pss_kb "$AGS_PID")"
for _ in $(seq 1 "$BENCH_COMPONENT_CYCLES"); do
  ags request -i "$INSTANCE" "volume-indicator" '{"action":"show"}' >/dev/null
  ags request -i "$INSTANCE" "volume-indicator" '{"action":"hide"}' >/dev/null
done
vi_after_rss_kb="$(read_rss_kb "$AGS_PID")"
vi_after_pss_kb="$(read_pss_kb "$AGS_PID")"
vi_delta_rss_kb=""
vi_delta_pss_kb=""
if is_number "$vi_before_rss_kb" && is_number "$vi_after_rss_kb"; then
  vi_delta_rss_kb="$((vi_after_rss_kb - vi_before_rss_kb))"
fi
if is_number "$vi_before_pss_kb" && is_number "$vi_after_pss_kb"; then
  vi_delta_pss_kb="$((vi_after_pss_kb - vi_before_pss_kb))"
fi

printf -- "%s\n" "- keyboard-switcher show (${BENCH_COMPONENT_CYCLES} cycles)"
ks_before_rss_kb="$(read_rss_kb "$AGS_PID")"
ks_before_pss_kb="$(read_pss_kb "$AGS_PID")"
for i in $(seq 1 "$BENCH_COMPONENT_CYCLES"); do
  active="EN"
  if [[ "$((i % 2))" -eq 0 ]]; then
    active="DA"
  fi
  ags request -i "$INSTANCE" "keyboard-switcher" "{\"action\":\"show\",\"config\":{\"layouts\":[\"EN\",\"DA\"],\"activeLayout\":\"${active}\",\"size\":\"sm\"}}" >/dev/null
  ags request -i "$INSTANCE" "keyboard-switcher" '{"action":"hide"}' >/dev/null
done
ks_after_rss_kb="$(read_rss_kb "$AGS_PID")"
ks_after_pss_kb="$(read_pss_kb "$AGS_PID")"
ks_delta_rss_kb=""
ks_delta_pss_kb=""
if is_number "$ks_before_rss_kb" && is_number "$ks_after_rss_kb"; then
  ks_delta_rss_kb="$((ks_after_rss_kb - ks_before_rss_kb))"
fi
if is_number "$ks_before_pss_kb" && is_number "$ks_after_pss_kb"; then
  ks_delta_pss_kb="$((ks_after_pss_kb - ks_before_pss_kb))"
fi

printf -- "%s\n" "- desktop-clock show (${BENCH_COMPONENT_CYCLES} cycles)"
dc_before_rss_kb="$(read_rss_kb "$AGS_PID")"
dc_before_pss_kb="$(read_pss_kb "$AGS_PID")"
for i in $(seq 1 "$BENCH_COMPONENT_CYCLES"); do
  show_date="false"
  if [[ "$((i % 2))" -eq 0 ]]; then
    show_date="true"
  fi
  ags request -i "$INSTANCE" "desktop-clock" "{\"action\":\"config\",\"config\":{\"showDate\":${show_date}}}" >/dev/null
  ags request -i "$INSTANCE" "desktop-clock" '{"action":"show"}' >/dev/null
  ags request -i "$INSTANCE" "desktop-clock" '{"action":"hide"}' >/dev/null
done
dc_after_rss_kb="$(read_rss_kb "$AGS_PID")"
dc_after_pss_kb="$(read_pss_kb "$AGS_PID")"
dc_delta_rss_kb=""
dc_delta_pss_kb=""
if is_number "$dc_before_rss_kb" && is_number "$dc_after_rss_kb"; then
  dc_delta_rss_kb="$((dc_after_rss_kb - dc_before_rss_kb))"
fi
if is_number "$dc_before_pss_kb" && is_number "$dc_after_pss_kb"; then
  dc_delta_pss_kb="$((dc_after_pss_kb - dc_before_pss_kb))"
fi

if [[ -n "$AGS_PID" ]] && [[ -r "/proc/${AGS_PID}/status" ]]; then
  printf -- "%s" "- memory (rss/pss) over ${BENCH_MEM_CYCLES} cycles: "
  before_rss_kb="$(read_rss_kb "$AGS_PID")"
  before_pss_kb="$(read_pss_kb "$AGS_PID")"
  rss_sum_kb=0
  rss_peak_kb=0
  pss_sum_kb=0
  pss_peak_kb=0
  pss_samples=0

  for _ in $(seq 1 "$BENCH_MEM_CYCLES"); do
    request '{"action":"next"}'
    request '{"action":"hide"}'
    sample_rss="$(read_rss_kb "$AGS_PID")"
    if is_number "$sample_rss"; then
      rss_sum_kb="$((rss_sum_kb + sample_rss))"
      if [[ "$sample_rss" -gt "$rss_peak_kb" ]]; then
        rss_peak_kb="$sample_rss"
      fi
    fi
    sample_pss="$(read_pss_kb "$AGS_PID")"
    if is_number "$sample_pss"; then
      pss_sum_kb="$((pss_sum_kb + sample_pss))"
      if [[ "$sample_pss" -gt "$pss_peak_kb" ]]; then
        pss_peak_kb="$sample_pss"
      fi
      pss_samples="$((pss_samples + 1))"
    fi
  done

  after_rss_kb="$(read_rss_kb "$AGS_PID")"
  after_pss_kb="$(read_pss_kb "$AGS_PID")"
  delta_rss_kb=""
  if is_number "$before_rss_kb" && is_number "$after_rss_kb"; then
    delta_rss_kb="$((after_rss_kb - before_rss_kb))"
  fi
  avg_rss_kb=0
  if [[ "$BENCH_MEM_CYCLES" -gt 0 ]]; then
    avg_rss_kb="$((rss_sum_kb / BENCH_MEM_CYCLES))"
  fi

  avg_pss_kb=""
  if [[ "$pss_samples" -gt 0 ]]; then
    avg_pss_kb="$((pss_sum_kb / pss_samples))"
  fi

  printf "rss avg=%sKB peak=%sKB delta=%sKB" "$avg_rss_kb" "$rss_peak_kb" "${delta_rss_kb:-}" 
  if [[ -n "$avg_pss_kb" || -n "$pss_peak_kb" ]]; then
    printf " pss avg=%sKB peak=%sKB" "${avg_pss_kb:-}" "${pss_peak_kb:-}"
  fi
  printf "\n"
else
  printf -- "%s\n" "- memory: skipped (no pid)"
  before_rss_kb=""
  after_rss_kb=""
  delta_rss_kb=""
  avg_rss_kb=""
  rss_peak_kb=""
  before_pss_kb=""
  after_pss_kb=""
  avg_pss_kb=""
  pss_peak_kb=""
fi

before_rss_json="$(json_number_or_null "$before_rss_kb")"
after_rss_json="$(json_number_or_null "$after_rss_kb")"
delta_rss_json="$(json_number_or_null "$delta_rss_kb")"
avg_rss_json="$(json_number_or_null "$avg_rss_kb")"
peak_rss_json="$(json_number_or_null "$rss_peak_kb")"
before_pss_json="$(json_number_or_null "$before_pss_kb")"
after_pss_json="$(json_number_or_null "$after_pss_kb")"
avg_pss_json="$(json_number_or_null "$avg_pss_kb")"
peak_pss_json="$(json_number_or_null "$pss_peak_kb")"
sm_delta_rss_json="$(json_number_or_null "$sm_delta_rss_kb")"
sm_delta_pss_json="$(json_number_or_null "$sm_delta_pss_kb")"
vi_delta_rss_json="$(json_number_or_null "$vi_delta_rss_kb")"
vi_delta_pss_json="$(json_number_or_null "$vi_delta_pss_kb")"
ks_delta_rss_json="$(json_number_or_null "$ks_delta_rss_kb")"
ks_delta_pss_json="$(json_number_or_null "$ks_delta_pss_kb")"
dc_delta_rss_json="$(json_number_or_null "$dc_delta_rss_kb")"
dc_delta_pss_json="$(json_number_or_null "$dc_delta_pss_kb")"

cat > "$EXTRAS_OUT" <<EOF
{
  "warm_show_ms": ${latency_ms},
  "cycle_total_ms": ${total_ms},
  "cycle_avg_ms": ${avg_ms},
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
    "avg": ${avg_pss_json},
    "peak": ${peak_pss_json}
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
    }
  }
}
EOF

python3 "${SCRIPT_DIR}/analyze-results.py" --input "$PERF_LOG" --output "$SUMMARY_OUT" --baseline "$BASELINE_PATH" --extras "$EXTRAS_OUT"

rm -f "$PERF_FLAG"

if [[ "$STARTED_INSTANCE" == "1" ]]; then
  ags quit "$INSTANCE" >/dev/null 2>&1 || true
fi

printf "Results: %s\n" "$SUMMARY_OUT"

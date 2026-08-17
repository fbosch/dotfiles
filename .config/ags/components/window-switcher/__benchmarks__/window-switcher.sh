#!/usr/bin/env bash
# Sourced by the shared AGS benchmark runner; result variables feed its stable extras schema.
function run_window_switcher_benchmark() {
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
}

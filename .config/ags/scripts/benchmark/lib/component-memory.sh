#!/usr/bin/env bash
# Shared process-memory measurement for feature-local component cycle drivers.
function run_component_memory_benchmark() {
  local label="$1"
  local result_prefix="$2"
  local cycle_function="$3"
  local before_rss_kb
  local before_pss_kb
  local after_rss_kb
  local after_pss_kb
  local delta_rss_kb=""
  local delta_pss_kb=""
  local index

  printf -- "%s\n" "- ${label} (${BENCH_COMPONENT_CYCLES} cycles)"
  before_rss_kb="$(read_combined_rss_kb)"
  before_pss_kb="$(read_combined_pss_kb)"
  for index in $(seq 1 "$BENCH_COMPONENT_CYCLES"); do
    "$cycle_function" "$index"
  done
  after_rss_kb="$(read_combined_rss_kb)"
  after_pss_kb="$(read_combined_pss_kb)"
  if is_number "$before_rss_kb" && is_number "$after_rss_kb"; then
    delta_rss_kb="$((after_rss_kb - before_rss_kb))"
  fi
  if is_number "$before_pss_kb" && is_number "$after_pss_kb"; then
    delta_pss_kb="$((after_pss_kb - before_pss_kb))"
  fi
  printf -v "${result_prefix}_delta_rss_kb" "%s" "$delta_rss_kb"
  printf -v "${result_prefix}_delta_pss_kb" "%s" "$delta_pss_kb"
}

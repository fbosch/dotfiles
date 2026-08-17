#!/usr/bin/env bash
# Sourced by the shared AGS benchmark runner.
function run_desktop_clock_benchmark() {
  run_component_memory_benchmark "desktop-clock show" dc benchmark_desktop_clock_cycle
}

function benchmark_desktop_clock_cycle() {
  local index="$1"
  local show_date="false"
  if [[ "$((index % 2))" -eq 0 ]]; then
    show_date="true"
  fi
  request_component "desktop-clock" "{\"action\":\"config\",\"config\":{\"showDate\":${show_date}}}"
  request_component "desktop-clock" '{"action":"show"}'
  request_component "desktop-clock" '{"action":"hide"}'
}

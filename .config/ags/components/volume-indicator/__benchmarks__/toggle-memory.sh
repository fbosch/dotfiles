#!/usr/bin/env bash
# Sourced by the shared AGS benchmark runner.
function run_volume_indicator_benchmark() {
  run_component_memory_benchmark "volume-indicator show" vi benchmark_volume_indicator_cycle
}

function benchmark_volume_indicator_cycle() {
  request_component "volume-indicator" '{"action":"show"}'
  request_component "volume-indicator" '{"action":"hide"}'
}

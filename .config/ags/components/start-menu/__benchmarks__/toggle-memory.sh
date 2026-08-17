#!/usr/bin/env bash
# Sourced by the shared AGS benchmark runner.
function run_start_menu_benchmark() {
  run_component_memory_benchmark "start-menu toggle" sm benchmark_start_menu_cycle
}

function benchmark_start_menu_cycle() {
  request_component "start-menu" '{"action":"show"}'
  request_component "start-menu" '{"action":"hide"}'
}

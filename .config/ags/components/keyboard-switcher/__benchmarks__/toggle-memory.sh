#!/usr/bin/env bash
# Sourced by the shared AGS benchmark runner.
function run_keyboard_switcher_benchmark() {
  run_component_memory_benchmark "keyboard-switcher show" ks benchmark_keyboard_switcher_cycle
}

function benchmark_keyboard_switcher_cycle() {
  local index="$1"
  local active="EN"
  if [[ "$((index % 2))" -eq 0 ]]; then
    active="DA"
  fi
  request_component "keyboard-switcher" "{\"action\":\"show\",\"config\":{\"layouts\":[\"EN\",\"DA\"],\"activeLayout\":\"${active}\",\"size\":\"sm\"}}"
  request_component "keyboard-switcher" '{"action":"hide"}'
}

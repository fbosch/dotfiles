#!/usr/bin/env bash
# Sourced by the shared AGS benchmark runner.
function run_audio_mixer_benchmark() {
  if target_enabled "audio-mixer"; then
    run_component_memory_benchmark "audio-mixer toggle" am benchmark_audio_mixer_cycle
  else
    printf -- "%s\n" "- audio-mixer: skipped"
  fi
}

function benchmark_audio_mixer_cycle() {
  request_component "audio-mixer-widget" '{"action":"show"}'
  request_component "audio-mixer-widget" '{"action":"hide"}'
  sleep "$BENCH_AUDIO_MIXER_SLEEP"
}

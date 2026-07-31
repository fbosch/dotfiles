#!/usr/bin/env bash

set -euo pipefail

tests=(
  .config/hypr/tests/runtime/window_capture_supervisor.sh
  .config/hypr/tests/runtime/lifecycle_recovery.sh
  .config/hypr/tests/runtime/night_light_missing_dependency.sh
)

bash -n "${tests[@]}"
shellcheck "${tests[@]}"

for test_file in "${tests[@]}"; do
  timeout --foreground 15s bash "$test_file"
done

timeout --foreground 15s luajit .config/hypr/tests/window_state_rules.lua
REPO_ROOT="$PWD" timeout --foreground 15s luajit .config/hypr/tests/runtime/window_state_daemon.lua

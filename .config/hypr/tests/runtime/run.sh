#!/usr/bin/env bash

set -euo pipefail

tests=(
  .config/hypr/tests/runtime/window_capture_supervisor.sh
  .config/hypr/tests/runtime/window_capture_ownership.sh
  .config/hypr/tests/runtime/lifecycle_recovery.sh
  .config/hypr/tests/runtime/night_light_missing_dependency.sh
  .config/hypr/tests/runtime/night_light_lifecycle.sh
  .config/hypr/tests/runtime/gaming_session_watchdog.sh
)

bash -n "${tests[@]}"
shellcheck "${tests[@]}"

for test_file in "${tests[@]}"; do
  timeout --foreground 15s bash "$test_file"
done

timeout --foreground 15s luajit .config/hypr/tests/window_state_rules.lua
timeout --foreground 15s luajit .config/hypr/tests/bind.lua
timeout --foreground 15s luajit .config/hypr/tests/window_move.lua
timeout --foreground 15s luajit .config/hypr/tests/portrait_rows.lua
timeout --foreground 15s luajit .config/hypr/tests/ultrawide_master.lua
timeout --foreground 15s busted --lua=luajit .config/hypr/tests/bind_spec.lua
timeout --foreground 15s busted --lua=luajit .config/hypr/tests/window_move_spec.lua
REPO_ROOT="$PWD" timeout --foreground 15s luajit .config/hypr/tests/runtime/window_state_daemon.lua

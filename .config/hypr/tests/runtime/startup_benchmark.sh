#!/usr/bin/env bash

set -euo pipefail

hypr_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
recorder="$hypr_dir/benchmarks/startup-recorder.sh"
state_dir="$(mktemp -d)"
trap 'rm -rf "$state_dir"' EXIT

run_recorder() {
  HYPRLAND_INSTANCE_SIGNATURE="current-session" HYPR_STARTUP_BENCHMARK_STATE_DIR="$state_dir" "$recorder" "$@"
}

run_recorder arm
campaign="$state_dir/campaigns/$(<"$state_dir/current")"

# The session used to arm the campaign cannot create a login sample.
run_recorder mark current-session waybar-layer-mapped 1.000000000
[[ -z "$(find "$campaign" -mindepth 1 -maxdepth 1 -type d -name 'run-*' -print -quit)" ]]

# Markers may finish before begin's asynchronous helper without being lost.
run_recorder mark login-1 waybar-layer-mapped 11.000000000
run_recorder begin login-1 10.000000000
run_recorder mark login-1 waybar-layer-mapped 12.000000000
run_recorder mark login-1 ags-component-host-main-complete 13.000000000
[[ "$(<"$campaign/run-1/waybar-layer-mapped")" == "11.000000000" ]]

# Repeated callbacks in the same compositor session cannot overwrite milestones.
run_recorder mark login-1 ags-component-host-main-complete 14.000000000
run_recorder mark login-1 waybar-layer-mapped 131.000000000
[[ "$(<"$campaign/run-1/ags-component-host-main-complete")" == "13.000000000" ]]
[[ ! -e "$campaign/run-1/timed-out" ]]

run_recorder begin login-2 20.000000000
run_recorder mark login-2 waybar-layer-mapped 19.000000000
run_recorder mark login-2 ags-component-host-main-complete 21.000000000

run_recorder begin login-3 30.000000000
report="$(run_recorder report)"
grep -Fq 'run-1: Waybar layer mapped 1000 ms; AGS component-host main complete 3000 ms' <<<"$report"
grep -Fq 'run-2: invalid monotonic ordering or duration; excluded' <<<"$report"
grep -Fq 'run-3: incomplete (compositor=recorded, waybar=missing, ags=missing)' <<<"$report"
grep -Fq 'n=1' <<<"$report"

run_recorder mark login-3 waybar-layer-mapped 151.000000000
report="$(run_recorder report)"
grep -Fq 'run-3: timed out after 120 s (compositor=recorded, waybar=missing, ags=missing)' <<<"$report"

run_recorder disarm
run_recorder mark login-3 waybar-layer-mapped 31.000000000
[[ ! -e "$campaign/run-3/waybar-layer-mapped" ]]

# A fully valid three-run campaign automatically stops accepting observations.
run_recorder arm
campaign="$state_dir/campaigns/$(<"$state_dir/current")"
run_recorder begin complete-1 10.000000000
run_recorder mark complete-1 waybar-layer-mapped 11.000000000
run_recorder mark complete-1 ags-component-host-main-complete 12.000000000
run_recorder begin complete-2 20.000000000
run_recorder mark complete-2 waybar-layer-mapped 21.000000000
run_recorder mark complete-2 ags-component-host-main-complete 22.000000000
run_recorder begin complete-3 30.000000000
run_recorder mark complete-3 waybar-layer-mapped 31.000000000
run_recorder mark complete-3 ags-component-host-main-complete 32.000000000
[[ ! -e "$state_dir/armed" ]]
grep -Fq 'n=3' < <(run_recorder report)

fake_bin="$state_dir/bin"
mkdir -p "$fake_bin"
cat >"$fake_bin/hyprctl" <<'EOF'
#!/usr/bin/env bash
if [[ "${FAKE_WAYBAR_MAPPED:-false}" == "true" ]]; then
  printf '%s\n' '{"DP-2":{"levels":{"0":[{"namespace":"waybar"}]}}}'
else
  printf '%s\n' '{}'
fi
EOF
cat >"$fake_bin/systemctl" <<'EOF'
#!/usr/bin/env bash
[[ "${FAKE_WAYBAR_SERVICE_ACTIVE:-false}" == "true" ]]
EOF
chmod +x "$fake_bin/hyprctl" "$fake_bin/systemctl"

PATH="$fake_bin:$PATH" run_recorder arm lazy-waybar
campaign="$state_dir/campaigns/$(<"$state_dir/current")"
for run in 1 2 3; do
  run_recorder begin "lazy-$run" "$((run * 10)).000000000"
  PATH="$fake_bin:$PATH" run_recorder mark "lazy-$run" ags-component-host-main-complete "$((run * 10 + 2)).000000000"
  [[ "$(<"$campaign/run-$run/waybar-at-ags-ready")" == "absent" ]]
  [[ ! -e "$campaign/run-$run/waybar-layer-mapped" ]]
done
[[ ! -e "$state_dir/armed" ]]
report="$(run_recorder report)"
grep -Fq 'run-1: Waybar absent at AGS readiness; AGS component-host main complete 2000 ms' <<<"$report"
grep -Fq 'Waybar absent at AGS readiness: 3/3 complete runs' <<<"$report"
grep -Fq 'AGS component-host main complete: median 2000 ms; range 2000–2000 ms (n=3)' <<<"$report"

PATH="$fake_bin:$PATH" run_recorder arm lazy-waybar
campaign="$state_dir/campaigns/$(<"$state_dir/current")"
run_recorder begin mapped-lazy 10.000000000
FAKE_WAYBAR_MAPPED=true PATH="$fake_bin:$PATH" \
  run_recorder mark mapped-lazy ags-component-host-main-complete 12.000000000
[[ "$(<"$campaign/run-1/waybar-at-ags-ready")" == "mapped" ]]
run_recorder begin service-lazy 20.000000000
FAKE_WAYBAR_SERVICE_ACTIVE=true PATH="$fake_bin:$PATH" \
  run_recorder mark service-lazy ags-component-host-main-complete 22.000000000
[[ "$(<"$campaign/run-2/waybar-at-ags-ready")" == "service-active" ]]
report="$(run_recorder report)"
grep -Fq 'run-1: Waybar state at AGS readiness was mapped; excluded' <<<"$report"
grep -Fq 'run-2: Waybar state at AGS readiness was service-active; excluded' <<<"$report"
grep -Fq 'summary: no comparable complete runs' <<<"$report"
run_recorder disarm

set +e
invalid_mode_output="$(run_recorder arm unknown 2>&1)"
invalid_mode_status=$?
set -e
[[ "$invalid_mode_status" -eq 2 ]]
[[ "$invalid_mode_output" == *'unknown capture mode: unknown'* ]]

runtime_dir="$state_dir/runtime"
mkdir -p \
	"$runtime_dir/hypr/login-lua" \
	"$runtime_dir/hypr/unarmed-lua" \
	"$runtime_dir/hypr/faulty-load" \
	"$runtime_dir/hypr/faulty-callback"

commands_file="$state_dir/commands"
mkdir -p "$state_dir/home/.local/state/hypr-startup-benchmark"
touch "$state_dir/home/.local/state/hypr-startup-benchmark/armed"
HYPR_DIR="$hypr_dir" COMMANDS_FILE="$commands_file" HOME="$state_dir/home" \
  XDG_RUNTIME_DIR="$runtime_dir" XDG_STATE_HOME="$state_dir/home/.local/state" \
  HYPRLAND_INSTANCE_SIGNATURE="login-lua" luajit - <<'LUA'
local root = assert(os.getenv("HYPR_DIR"))
package.path = root .. "/?.lua;" .. root .. "/?/init.lua;" .. package.path
local events = {}
hl = {
  exec_cmd = function(command)
    local file = assert(io.open(assert(os.getenv("COMMANDS_FILE")), "a"))
    file:write(command, "\n")
    file:close()
  end,
  on = function(name, callback)
    events[name] = callback
  end,
}
require("autostart")
assert(events["config.reloaded"] == nil)
assert(type(events["layer.opened"]) == "function")
assert(type(events["layer.closed"]) == "function")
events["hyprland.start"]()
local command_count = 0
for _ in io.lines(assert(os.getenv("COMMANDS_FILE"))) do
  command_count = command_count + 1
end
events["hyprland.start"]()
local repeated_count = 0
for _ in io.lines(assert(os.getenv("COMMANDS_FILE"))) do
  repeated_count = repeated_count + 1
end
assert(repeated_count == command_count)
events["layer.opened"]({ namespace = "waybar" })
events["layer.closed"]({ namespace = "waybar" })
LUA
first_command="$(head -n 1 "$commands_file")"
[[ "$first_command" == *"startup-recorder.sh' 'begin' 'login-lua'"* ]]
[[ ! "$first_command" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]
grep -Fq "startup-recorder.sh' 'mark' 'login-lua' 'waybar-layer-mapped'" "$commands_file"
grep -Fq "uwsm-app -s s -- env HYPR_STARTUP_BENCHMARK_SESSION='login-lua' ~/.config/ags/start-daemons.sh" "$commands_file"
grep -Fq 'runtime/desktop/waybar-monitor.sh' "$commands_file"
grep -Fq "waybar-monitor.sh' 'layer-opened'" "$commands_file"
grep -Fq "waybar-monitor.sh' 'layer-closed'" "$commands_file"
if grep -Fq 'uwsm-app -s s -- waybar' "$commands_file"; then
  exit 1
fi

unarmed_commands="$state_dir/unarmed-commands"
HYPR_DIR="$hypr_dir" COMMANDS_FILE="$unarmed_commands" HOME="$state_dir/unarmed-home" \
  XDG_RUNTIME_DIR="$runtime_dir" XDG_STATE_HOME="$state_dir/unarmed-home/.local/state" \
  HYPRLAND_INSTANCE_SIGNATURE="unarmed-lua" luajit - <<'LUA'
local root = assert(os.getenv("HYPR_DIR"))
package.path = root .. "/?.lua;" .. root .. "/?/init.lua;" .. package.path
local events = {}
hl = {
  exec_cmd = function(command)
    local file = assert(io.open(assert(os.getenv("COMMANDS_FILE")), "a"))
    file:write(command, "\n")
    file:close()
  end,
  on = function(name, callback)
    events[name] = callback
  end,
}
require("autostart")
assert(type(events["layer.opened"]) == "function")
assert(type(events["layer.closed"]) == "function")
events["hyprland.start"]()
LUA
if grep -Fq 'startup-recorder.sh' "$unarmed_commands"; then
  exit 1
fi
grep -Fq 'uwsm-app -s s -- ~/.config/ags/start-daemons.sh' "$unarmed_commands"
grep -Fq 'runtime/desktop/waybar-monitor.sh' "$unarmed_commands"
if grep -Fq 'uwsm-app -s s -- waybar' "$unarmed_commands"; then
  exit 1
fi

# Recorder load failures must not block the normal desktop launch path.
faulty_load_commands="$state_dir/faulty-load-commands"
HYPR_DIR="$hypr_dir" COMMANDS_FILE="$faulty_load_commands" XDG_RUNTIME_DIR="$runtime_dir" \
  HYPRLAND_INSTANCE_SIGNATURE="faulty-load" luajit - <<'LUA'
local root = assert(os.getenv("HYPR_DIR"))
package.path = root .. "/?.lua;" .. root .. "/?/init.lua;" .. package.path
package.preload["benchmarks.startup-recorder"] = function()
  error("simulated recorder load failure")
end
local events = {}
hl = {
  exec_cmd = function(command)
    local file = assert(io.open(assert(os.getenv("COMMANDS_FILE")), "a"))
    file:write(command, "\n")
    file:close()
  end,
  on = function(name, callback)
    events[name] = callback
  end,
}
require("autostart")
assert(type(events["layer.opened"]) == "function")
assert(type(events["layer.closed"]) == "function")
events["hyprland.start"]()
LUA
grep -Fq 'uwsm-app -s s -- ~/.config/ags/start-daemons.sh' "$faulty_load_commands"
if grep -Fq 'startup-recorder.sh' "$faulty_load_commands"; then
  exit 1
fi

# Recorder generation and dispatch failures must not block app startup or escape event handlers.
faulty_callback_commands="$state_dir/faulty-callback-commands"
HYPR_DIR="$hypr_dir" COMMANDS_FILE="$faulty_callback_commands" XDG_RUNTIME_DIR="$runtime_dir" \
  HYPRLAND_INSTANCE_SIGNATURE="faulty-callback" luajit - <<'LUA'
local root = assert(os.getenv("HYPR_DIR"))
package.path = root .. "/?.lua;" .. root .. "/?/init.lua;" .. package.path
package.preload["benchmarks.startup-recorder"] = function()
  return {
    armed = function() return true end,
    wrap_ags_command = function(command) return command end,
    begin = function() return "benchmark-command" end,
    mark_waybar_layer_mapped = function() error("simulated marker failure") end,
  }
end
local events = {}
hl = {
  exec_cmd = function(command)
    if command == "benchmark-command" then error("simulated dispatch failure") end
    local file = assert(io.open(assert(os.getenv("COMMANDS_FILE")), "a"))
    file:write(command, "\n")
    file:close()
  end,
  on = function(name, callback)
    events[name] = callback
  end,
}
require("autostart")
events["hyprland.start"]()
events["layer.opened"]({ namespace = "waybar" })
LUA
grep -Fq 'uwsm-app -s s -- ~/.config/ags/start-daemons.sh' "$faulty_callback_commands"
if grep -Fq 'startup-recorder.sh' "$faulty_callback_commands"; then
  exit 1
fi

-- Autostart commands ported from autostart.conf.

local paths = require("lib.paths")
local startup_benchmark_ok, startup_benchmark = pcall(require, "benchmarks.startup-recorder")
local system = require("lib.system")
local host = system.hostname()

local function uwsm(scope, command)
	return "uwsm-app -s " .. scope .. " -- " .. command
end

local function session(command)
	return uwsm("s", command)
end

local function background(command)
	return uwsm("b", command)
end

local function benchmark_is_armed()
	if not startup_benchmark_ok then
		return false
	end

	local ok, armed = pcall(startup_benchmark.armed)
	return ok and armed
end

local function record_benchmark(command)
	local ok, value = pcall(command)
	if ok and type(value) == "string" then
		pcall(hl.exec_cmd, value)
	end
end

local benchmark_armed = benchmark_is_armed()
local ags_command = "~/.config/ags/start-daemons.sh"
if benchmark_armed then
	local ok, value = pcall(startup_benchmark.wrap_ags_command, ags_command)
	if ok and type(value) == "string" then
		ags_command = value
	else
		benchmark_armed = false
	end
end

local commands = {
	session("atuin daemon start"),
	background("foot --server"),
	background("swayosd-server"),
	background(paths.runtime_script("windows/daemons/window-state/window-state.sh")),
	background(paths.runtime_script("windows/daemons/window-capture/window-capture-daemon.sh")),
	background(paths.runtime_script("windows/daemons/picture-in-picture.sh")),
	background(paths.runtime_script("gaming/daemons/gaming-session-watchdog/gaming-session-watchdog.sh")),
	background(paths.runtime_script("gaming/gamescope-clipboard-sync.sh")),
	session("hyprpaper"),
	session("waybar"),
	session("swaync -c ~/.config/swaync/config.json -s ~/.config/swaync/style.css"),
	session(ags_command),
	background(paths.runtime_script("desktop/night-light.sh") .. " daemon"),
	-- Session-scoped because it coordinates Waybar, AGS, SwayNC, and PiP.
	session(paths.runtime_script("desktop/waybar-monitor.sh")),
	paths.runtime_script("startup/startup-desktop-ready.sh"),
}

if host == "rvn-pc" then
	table.insert(commands, 1, "xrandr --output DP-2 --primary")
end

local function run_commands()
	for _, command in ipairs(commands) do
		hl.exec_cmd(command)
	end
end

if benchmark_armed then
	hl.on("hyprland.start", function()
		record_benchmark(startup_benchmark.begin)
		run_commands()
	end)

	hl.on("layer.opened", function(layer)
		if layer and layer.namespace == "waybar" then
			record_benchmark(startup_benchmark.mark_waybar_layer_mapped)
		end
	end)
else
	hl.on("hyprland.start", run_commands)
end

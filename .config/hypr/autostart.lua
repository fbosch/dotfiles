-- Autostart commands ported from autostart.conf.

local command_util = require("lib.command")
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

local function claim_autostart()
	local runtime_dir = os.getenv("XDG_RUNTIME_DIR")
	local signature = os.getenv("HYPRLAND_INSTANCE_SIGNATURE")
	if not runtime_dir or not signature or signature == "" then
		return true
	end

	local marker = runtime_dir .. "/hypr/" .. signature .. "/autostart.claimed"
	local existing = io.open(marker, "r")
	if existing then
		existing:close()
		return false
	end

	local handle = io.open(marker, "w")
	if not handle then
		return false
	end
	handle:write(signature, "\n")
	handle:close()
	return true
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

local waybar_monitor = paths.runtime_script("desktop/waybar-monitor.sh")
local commands = {
	-- Start the demand owner early; it does not launch Waybar until requested.
	session(waybar_monitor),
	session("atuin daemon start"),
	background("foot --server"),
	background("swayosd-server"),
	background(paths.runtime_script("windows/daemons/window-state/window-state.sh")),
	background(paths.runtime_script("windows/daemons/window-capture/window-capture-daemon.sh")),
	background(paths.runtime_script("windows/daemons/picture-in-picture.sh")),
	background(paths.runtime_script("gaming/daemons/gaming-session-watchdog/gaming-session-watchdog.sh")),
	background(paths.runtime_script("gaming/gamescope-clipboard-sync.sh")),
	session("hyprpaper"),
	session("swaync -c ~/.config/swaync/config.json -s ~/.config/swaync/style.css"),
	session(ags_command),
	background(paths.runtime_script("desktop/night-light.sh") .. " daemon"),
	paths.runtime_script("startup/startup-desktop-ready.sh"),
}

if host == "rvn-pc" then
	table.insert(commands, 1, "xrandr --output DP-2 --primary")
end

local function run_commands()
	for _, startup_command in ipairs(commands) do
		hl.exec_cmd(startup_command)
	end
end

local function notify_waybar_monitor(event)
	pcall(hl.exec_cmd, command_util.line(waybar_monitor, event) .. " >/dev/null 2>&1")
end

hl.on("hyprland.start", function()
	if not claim_autostart() then
		return
	end
	if benchmark_armed then
		record_benchmark(startup_benchmark.begin)
	end
	run_commands()
end)

hl.on("layer.opened", function(layer)
	if layer and layer.namespace == "waybar" then
		notify_waybar_monitor("layer-opened")
		if benchmark_armed then
			record_benchmark(startup_benchmark.mark_waybar_layer_mapped)
		end
	end
end)

hl.on("layer.closed", function(layer)
	if layer and layer.namespace == "waybar" then
		notify_waybar_monitor("layer-closed")
	end
end)

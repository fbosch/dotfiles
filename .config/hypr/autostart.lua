-- Autostart commands ported from autostart.conf.

local paths = require("lib.paths")
local system = require("lib.system")
local taskbar_apps = require("taskbar")
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

local commands = {
	session("atuin daemon start"),
	background("foot --server"),
	background("flake-check-updates"),
	background("swayosd-server"),
	background(paths.runtime_script("windows/daemons/window-state/window-state.sh")),
	background(
		paths.runtime_script("windows/daemons/custom-layout-drag-resize/custom-layout-drag-resize.sh") .. " daemon"
	),
	background(paths.runtime_script("windows/daemons/minimized-state/minimized-state-daemon.sh")),
	background(paths.runtime_script("windows/daemons/window-capture/window-capture-daemon.sh")),
	background(paths.runtime_script("gamescope/daemons/gamescope-profile-watchdog/gamescope-profile-watchdog.sh")),
	background(paths.runtime_script("gamescope/gamescope-clipboard-sync.sh")),
	session("hyprpaper"),
	session("waybar"),
	session("swaync -c ~/.config/swaync/config.json -s ~/.config/swaync/style.css"),
	session("~/.config/ags/start-daemons.sh"),
	background(paths.runtime_script("desktop/toggle-night-light.sh") .. " daemon"),
	session(paths.runtime_script("desktop/waybar-edge-monitor.sh")),
	paths.runtime_script("startup/startup-desktop-ready.sh"),
	"vicinae server",
}

if host == "rvn-pc" then
	table.insert(commands, 1, "xrandr --output DP-2 --primary")
end

for _, command in ipairs(taskbar_apps.autostart_commands()) do
	commands[#commands + 1] = command
end

local function run_commands()
	for _, command in ipairs(commands) do
		hl.exec_cmd(command)
	end
end

hl.on("hyprland.start", function()
	run_commands()
end)

-- Autostart commands ported from autostart.conf.

local M = {}
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

M.commands = {
	-- background("hypridle"),
	session("atuin daemon start"),
	background("foot --server"),
	background("flake-check-updates"),
	background("swayosd-server"),
	background(paths.runtime_script("windows/window-state.sh")),
	background(paths.runtime_script("windows/minimized-state-daemon.sh")),
	background(paths.runtime_script("windows/window-capture-daemon.sh")),
	background(paths.runtime_script("gamescope/gamescope-profile-watchdog.sh")),
	background(paths.runtime_script("gamescope/gamescope-clipboard-sync.sh")),
	session("hyprpaper"),
	session("waybar"),
	session("swaync -c ~/.config/swaync/config.json -s ~/.config/swaync/style.css"),
	session("~/.config/ags/start-daemons.sh"),
	background(paths.runtime_script("desktop/toggle-night-light.sh") .. " daemon"),
	session(paths.runtime_script("desktop/waybar-edge-monitor.sh")),
	paths.runtime_script("startup/startup-desktop-ready.sh"),
	session("vicinae server"),
}

if host == "rvn-pc" then
	table.insert(M.commands, 1, "xrandr --output DP-2 --primary")
end

for _, command in ipairs(taskbar_apps.autostart_commands()) do
	M.commands[#M.commands + 1] = command
end

function M.marker_path()
	local runtime_dir = os.getenv("XDG_RUNTIME_DIR") or "/tmp"
	local instance = os.getenv("HYPRLAND_INSTANCE_SIGNATURE") or "unknown"

	return runtime_dir .. "/hypr-autostart-" .. instance .. ".done"
end

function M.has_run()
	local file = io.open(M.marker_path(), "r")
	if file then
		file:close()
		return true
	end

	return false
end

function M.mark_run()
	local file = io.open(M.marker_path(), "w")
	if file then
		file:write("1\n")
		file:close()
	end
end

function M.run_once(execute)
	if M.has_run() then
		return false
	end

	M.mark_run()
	execute = execute or hl.exec_cmd

	for _, command in ipairs(M.commands) do
		execute(command)
	end

	return true
end

function M.install()
	hl.on("hyprland.start", function()
		M.run_once()
	end)
end

M.install()

return M

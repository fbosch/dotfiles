local command = require("lib.command")
local paths = require("lib.paths")

local M = {}

local waybar_monitor = paths.runtime_script("desktop/waybar-monitor.sh")

local function control(message)
	local unavailable = command.line(
		"notify-send",
		"-a",
		"Hyprland",
		"Waybar unavailable",
		"waybar-monitor did not accept the visibility request"
	)
	return hl.dsp.exec_cmd(command.line(waybar_monitor, message) .. " >/dev/null 2>&1 || " .. unavailable)
end

M.hold = control("hold")
M.release = control("release")

return M

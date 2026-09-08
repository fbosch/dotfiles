local command = require("lib.command")
local paths = require("lib.paths")

local M = {}

local waybar_control = paths.runtime_script("desktop/waybar-control.sh")

local function control(message)
	local unavailable =
		command.line("notify-send", "-a", "Hyprland", "Waybar unavailable", "Waybar control request was not accepted")
	return hl.dsp.exec_cmd(command.line(waybar_control, message) .. " >/dev/null 2>&1 || " .. unavailable)
end

M.hold = control("hold")
M.prewarm = control("prewarm")
M.release = control("release")

return M

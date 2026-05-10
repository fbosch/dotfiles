local command_lib = require("lib.command")

local M = {}

local function hint_arg(hint)
	return "-h " .. command_lib.arg(hint)
end

function M.send(options)
	local command = "notify-send -a Hyprland"

	for _, hint in ipairs(options.hints or {}) do
		command = command .. " " .. hint_arg(hint)
	end

	command = command .. " " .. command_lib.arg(options.summary or "")

	if options.body then
		command = command .. " " .. command_lib.arg(options.body)
	end

	if options.icon then
		command = command .. " -i " .. command_lib.arg(options.icon)
	end

	hl.exec_cmd(command)
end

return M

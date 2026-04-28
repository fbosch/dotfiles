local system = require("lib.system")

local M = {}

local function hint_arg(hint)
	return "-h " .. system.shell_quote(hint)
end

function M.send(options)
	local command = "notify-send -a Hyprland"

	for _, hint in ipairs(options.hints or {}) do
		command = command .. " " .. hint_arg(hint)
	end

	command = command .. " " .. system.shell_quote(options.summary or "")

	if options.body then
		command = command .. " " .. system.shell_quote(options.body)
	end

	if options.icon then
		command = command .. " -i " .. system.shell_quote(options.icon)
	end

	hl.exec_cmd(command)
end

return M

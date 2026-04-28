local system = require("lib.system")

local M = {}

function M.request(component, payload)
	local command = "ags request -i ags-bundled " .. component
	if payload then
		command = command .. " " .. system.shell_quote(payload)
	end

	hl.exec_cmd(command)
end

return M

local command_lib = require("lib.command")
local json = require("lib.json")

local M = {}

function M.request(component, payload)
	local command = "ags request -i ags-bundled " .. component
	if payload then
		if type(payload) == "table" then
			payload = json.encode(payload)
		end
		command = command .. " " .. command_lib.arg(payload)
	end

	hl.exec_cmd(command)
end

return M

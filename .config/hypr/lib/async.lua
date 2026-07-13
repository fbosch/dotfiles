local command = require("lib.command")
local paths = require("lib.paths")

local M = {}

function M.runtime_lua(script, ...)
	return hl.dsp.exec_cmd(command.line("lua", paths.runtime_script(script), ...))
end

return M

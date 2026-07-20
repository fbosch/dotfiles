local command = require("lib.command")
local paths = require("lib.paths")

local M = {}

function M.runtime_lua(script, ...)
	return hl.dsp.exec_cmd(command.line("lua", paths.runtime_script(script), ...))
end

function M.defer(callback, timeout)
	if hl.timer then
		hl.timer(callback, { timeout = timeout or 100, type = "oneshot" })
		return
	end

	callback()
end

return M

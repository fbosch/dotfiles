local window = require("lib.window")

local M = {}

local function exec(command)
	return hl.dsp.exec_cmd(command)
end

function M.switch()
	local active = window.active()
	if active and active.contentType == "game" then
		hl.dispatch(hl.dsp.pass({ window = "activewindow" }))
		return
	end

	hl.dispatch(exec("bash ~/.config/hypr/runtime/desktop/switch-layout.sh"))
end

return M

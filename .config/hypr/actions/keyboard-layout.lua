local M = {}

local function exec(command)
	return hl.dsp.exec_cmd(command)
end

function M.switch()
	hl.dispatch(exec("bash ~/.config/hypr/runtime/desktop/switch-layout.sh"))
end

return M

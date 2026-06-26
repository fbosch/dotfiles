local window = require("lib.window")

local M = {}

local function exec(command)
	return hl.dsp.exec_cmd(command)
end

local function is_gaming_class(value)
	local class = tostring(value or ""):lower()
	return class == "gamescope" or class:match("^steam_app_%d+$") ~= nil
end

function M.switch()
	local active = window.active()
	if active and (is_gaming_class(active.class) or is_gaming_class(active.initialClass)) then
		hl.dispatch(hl.dsp.pass({ window = "activewindow" }))
		return
	end

	hl.dispatch(exec("bash ~/.config/hypr/runtime/desktop/switch-layout.sh"))
end

return M

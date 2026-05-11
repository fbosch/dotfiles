local active_window = require("lib.window").active
local layout_util = require("layouts.util")

local M = {}

local function apply_portrait_split(workspace, changed_window)
	if not workspace or not workspace.monitor or workspace.monitor.name ~= "HDMI-A-2" or not workspace.active then
		return
	end

	if workspace.tiled_layout ~= "dwindle" then
		return
	end

	local count, first, third = layout_util.tiled_summary(workspace)
	if count == 2 then
		layout_util.dispatch_on_window(first, hl.dsp.layout("splitratio 0.67 exact"))
	elseif count == 3 then
		layout_util.dispatch_on_window(changed_window or third, hl.dsp.layout("splitratio 1.0 exact"))
	end
end

function M.apply_all()
	for _, window in ipairs(hl.get_windows()) do
		apply_portrait_split(window.workspace)
	end
end

hl.on("window.open", function(window)
	if layout_util.is_tiled(window) then
		apply_portrait_split(window.workspace, window)
	end
end)

hl.on("window.close", function(window)
	if layout_util.is_tiled(window) then
		apply_portrait_split(window.workspace)
	end
end)

hl.on("window.move_to_workspace", function(window, workspace)
	if layout_util.is_tiled(window) then
		apply_portrait_split(workspace, active_window())
	end
end)

hl.on("workspace.move_to_monitor", function(workspace)
	apply_portrait_split(workspace)
end)

M.apply_all()

return M

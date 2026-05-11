local layout_util = require("layouts.util")

local M = {}

local function is_portrait_workspace(workspace)
	return workspace
		and workspace.monitor
		and workspace.monitor.name == "HDMI-A-2"
		and workspace.active
		and tostring(workspace.name or ""):match("^[1-9]$")
		and workspace.tiled_layout == "dwindle"
end

local function apply_portrait_split(workspace, changed_window)
	if not is_portrait_workspace(workspace) then
		return
	end

	local count, first, second, third = layout_util.tiled_summary(workspace)
	if count == 2 then
		layout_util.dispatch_on_window(first, hl.dsp.layout("splitratio 0.67 exact"))
		layout_util.dispatch_on_window(second, hl.dsp.layout("preselect d"))
	elseif count == 3 then
		layout_util.dispatch_on_window(first, hl.dsp.layout("splitratio 0.67 exact"))
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

M.apply_all()

return M

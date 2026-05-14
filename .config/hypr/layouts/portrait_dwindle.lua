local layout_util = require("layouts.util")

local M = {}
local should_apply_count = layout_util.count_gate()

local function is_portrait_workspace(workspace)
	return workspace
		and workspace.monitor
		and workspace.monitor.name == "HDMI-A-2"
		and workspace.active
		and tostring(workspace.name or ""):match("^[1-9]$")
		and workspace.tiled_layout == "dwindle"
end

local function apply_portrait_split(workspace, opts)
	opts = opts or {}

	if not is_portrait_workspace(workspace) then
		return
	end

	local count, first, second, third = layout_util.tiled_summary(workspace)
	if count == 2 then
		if not opts.force and not should_apply_count(workspace, count) then
			return
		end

		layout_util.dispatch_on_window(first, hl.dsp.layout("splitratio 0.67 exact"))
		layout_util.dispatch_on_window(second, hl.dsp.layout("preselect d"))
	elseif count == 3 then
		if not opts.force and not should_apply_count(workspace, count) then
			return
		end

		layout_util.dispatch_on_window(first, hl.dsp.layout("splitratio 0.67 exact"))
		layout_util.dispatch_on_window(second, hl.dsp.layout("splitratio 1.0 exact"))
	end
end

function M.apply_all()
	local seen = {}
	for _, window in ipairs(hl.get_windows()) do
		local workspace = window.workspace
		local key = layout_util.workspace_key(workspace)
		if key and not seen[key] then
			seen[key] = true
			apply_portrait_split(workspace, { force = true })
		end
	end
end

hl.on("window.open", function(window)
	if layout_util.is_tiled(window) then
		layout_util.defer(function()
			apply_portrait_split(window.workspace, { force = true })
		end)
	end
end)

hl.on("window.close", function(window)
	if layout_util.is_tiled(window) then
		apply_portrait_split(window.workspace)
	end
end)

hl.on("window.move_to_workspace", function(window)
	if layout_util.is_tiled(window) then
		layout_util.defer(function()
			apply_portrait_split(window.workspace, { force = true })
		end)
	end
end)

M.apply_all()

return M

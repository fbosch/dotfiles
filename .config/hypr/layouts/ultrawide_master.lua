local layout_util = require("layouts.util")

local should_apply_count = layout_util.count_gate()
local orientation_left = hl.dsp.layout("orientationleft")
local orientation_center = hl.dsp.layout("orientationcenter")
local mfact_two = hl.dsp.layout("mfact exact 0.7")
local mfact_three = hl.dsp.layout("mfact exact 0.4")

local function apply_ultrawide_master(workspace)
	if not workspace or not workspace.monitor or workspace.monitor.name ~= "DP-2" or not workspace.active then
		return
	end

	if workspace.tiled_layout ~= "master" then
		return
	end

	local count = layout_util.tiled_summary(workspace)
	if count == 2 then
		if not should_apply_count(workspace, count) then
			return
		end

		hl.dispatch(orientation_left)
		hl.dispatch(mfact_two)
	elseif count == 3 then
		if not should_apply_count(workspace, count) then
			return
		end

		hl.dispatch(orientation_center)
		hl.dispatch(mfact_three)
	end
end

hl.on("window.open", function(window)
	if layout_util.is_tiled(window) then
		apply_ultrawide_master(window.workspace)
	end
end)

hl.on("window.close", function(window)
	if layout_util.is_tiled(window) then
		apply_ultrawide_master(window.workspace)
	end
end)

hl.on("window.move_to_workspace", function(window)
	if layout_util.is_tiled(window) then
		layout_util.defer(function()
			apply_ultrawide_master(window.workspace)
		end)
	end
end)

return {
	apply = apply_ultrawide_master,
}

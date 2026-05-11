local layout_util = require("layouts.util")

local function active_monitor_name()
	local monitor = hl.get_active_monitor and hl.get_active_monitor() or nil
	return monitor and monitor.name or ""
end

local function apply_ultrawide_master(workspace)
	if not workspace or not workspace.monitor or workspace.monitor.name ~= "DP-2" or not workspace.active then
		return
	end

	if workspace.tiled_layout ~= "master" or active_monitor_name() ~= "DP-2" then
		return
	end

	local count = layout_util.tiled_summary(workspace)
	if count == 2 then
		hl.dispatch(hl.dsp.layout("orientationleft"))
		hl.dispatch(hl.dsp.layout("mfact exact 0.7"))
	elseif count == 3 then
		hl.dispatch(hl.dsp.layout("orientationcenter"))
		hl.dispatch(hl.dsp.layout("mfact exact 0.4"))
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

local active_window = hl.get_active_window and hl.get_active_window() or nil
if active_window then
	apply_ultrawide_master(active_window.workspace)
end

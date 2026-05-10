local function workspace_key(workspace)
	return workspace and (workspace.name or (workspace.id and tostring(workspace.id))) or ""
end

local function active_workspace_key()
	local window = hl.get_active_window and hl.get_active_window() or nil
	return window and workspace_key(window.workspace) or ""
end

local function tiled_count(workspace)
	local count = 0
	for _, window in ipairs(workspace:get_windows()) do
		if window.visible and not window.floating then
			count = count + 1
		end
	end

	return count
end

local function apply_dp2_master(workspace)
	if not workspace or not workspace.monitor or workspace.monitor.name ~= "DP-2" or not workspace.active then
		return
	end

	if workspace.tiled_layout ~= "master" or workspace_key(workspace) ~= active_workspace_key() then
		return
	end

	local count = tiled_count(workspace)
	if count == 2 then
		hl.dispatch(hl.dsp.layout("orientationleft"))
		hl.dispatch(hl.dsp.layout("mfact exact 0.7"))
	elseif count == 3 then
		hl.dispatch(hl.dsp.layout("orientationcenter"))
		hl.dispatch(hl.dsp.layout("mfact exact 0.4"))
	end
end

hl.on("window.open", function(window)
	apply_dp2_master(window.workspace)
end)

hl.on("window.close", function(window)
	apply_dp2_master(window.workspace)
end)

hl.on("window.move_to_workspace", function(_, workspace)
	apply_dp2_master(workspace)
end)

local active_window = hl.get_active_window and hl.get_active_window() or nil
if active_window then
	apply_dp2_master(active_window.workspace)
end

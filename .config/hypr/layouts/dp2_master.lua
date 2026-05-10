local applied_signatures = {}

local function workspace_key(workspace)
	return workspace.name or (workspace.id and tostring(workspace.id)) or workspace
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

	if workspace.tiled_layout ~= "master" then
		return
	end

	local count = tiled_count(workspace)
	local key = workspace_key(workspace)
	local signature = workspace.monitor.name .. ":" .. workspace.tiled_layout .. ":" .. count
	if applied_signatures[key] == signature then
		return
	end

	applied_signatures[key] = signature

	if count == 2 then
		hl.dispatch(hl.dsp.layout("orientationleft"))
		hl.dispatch(hl.dsp.layout("mfact exact 0.7"))
	elseif count == 3 then
		hl.dispatch(hl.dsp.layout("orientationcenter"))
		hl.dispatch(hl.dsp.layout("mfact exact 0.5"))
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

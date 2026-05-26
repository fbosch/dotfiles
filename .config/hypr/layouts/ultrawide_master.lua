local dispatch = hl.dispatch
local orientation_left = hl.dsp.layout("orientationleft")
local orientation_center = hl.dsp.layout("orientationcenter")
local mfact_two = hl.dsp.layout("mfact exact 0.67")
local mfact_three = hl.dsp.layout("mfact exact 0.4")
local applied_counts = {}

local function should_apply_count(workspace, count, force)
	local key = workspace and (workspace.id or workspace.name) or nil
	if not key or (not force and applied_counts[key] == count) then
		return false
	end

	applied_counts[key] = count
	return true
end

local function tiled_count(workspace)
	local count = 0
	local windows = workspace:get_windows()

	for index = 1, #windows do
		local window = windows[index]
		if window.visible and not window.floating then
			count = count + 1
			if count > 3 then
				return count
			end
		end
	end

	return count
end

local function apply_ultrawide_master(workspace, force)
	if not workspace or not workspace.monitor or workspace.monitor.name ~= "DP-2" or not workspace.active then
		return
	end

	if workspace.tiled_layout ~= "master" then
		return
	end

	local count = tiled_count(workspace)
	if count == 2 then
		if not should_apply_count(workspace, count, force) then
			return
		end

		dispatch(orientation_left)
		dispatch(mfact_two)
	elseif count == 3 then
		if not should_apply_count(workspace, count, force) then
			return
		end

		dispatch(orientation_center)
		dispatch(mfact_three)
	end
end

hl.on("window.open", function(window)
	if window and not window.floating then
		apply_ultrawide_master(window.workspace)
	end
end)

hl.on("window.close", function(window)
	if window and not window.floating then
		apply_ultrawide_master(window.workspace)
	end
end)

hl.on("window.move_to_workspace", function(window)
	if window and not window.floating then
		apply_ultrawide_master(window.workspace)
	end
end)

return {
	apply = apply_ultrawide_master,
}

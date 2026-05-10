local function tiled_count(workspace)
	local count = 0
	for _, window in ipairs(workspace:get_windows()) do
		if window.visible and not window.floating then
			count = count + 1
		end
	end

	return count
end

local function apply_portrait_split(workspace)
	if not workspace or not workspace.monitor or workspace.monitor.name ~= "HDMI-A-2" then
		return
	end

	if workspace.tiled_layout ~= "dwindle" then
		return
	end

	local count = tiled_count(workspace)
	if count == 2 then
		hl.dispatch(hl.dsp.layout("splitratio 0.67 exact"))
	elseif count == 3 then
		hl.dispatch(hl.dsp.layout("splitratio 1.0 exact"))
	end
end

local function apply_portrait_split_soon(workspace)
	hl.timer(function()
		apply_portrait_split(workspace)
	end, { timeout = 50, type = "oneshot" })
end

hl.on("window.open", function(window)
	apply_portrait_split_soon(window.workspace)
end)

hl.on("window.close", function(window)
	apply_portrait_split_soon(window.workspace)
end)

hl.on("window.move_to_workspace", function(_, workspace)
	apply_portrait_split_soon(workspace)
end)

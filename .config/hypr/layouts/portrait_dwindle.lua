local active_window = require("lib.window").active

local function address(window)
	return window and window.address and "address:" .. window.address or nil
end

local function tiled_windows(workspace)
	local windows = {}
	for _, window in ipairs(workspace:get_windows()) do
		if window.visible and not window.floating then
			table.insert(windows, window)
		end
	end

	return windows
end

local function tiled_count(workspace)
	return #tiled_windows(workspace)
end

local function dispatch_on_workspace(workspace, dispatcher)
	local windows = tiled_windows(workspace)
	local target = address(windows[1])
	if not target then
		return
	end

	local previous = address(active_window())
	hl.dispatch(hl.dsp.focus({ window = target }))
	hl.dispatch(dispatcher)

	if previous and previous ~= target then
		hl.dispatch(hl.dsp.focus({ window = previous }))
	end
end

local function apply_portrait_split(workspace)
	if not workspace or not workspace.monitor or workspace.monitor.name ~= "HDMI-A-2" or not workspace.active then
		return
	end

	if workspace.tiled_layout ~= "dwindle" then
		return
	end

	local count = tiled_count(workspace)
	if count == 2 then
		dispatch_on_workspace(workspace, hl.dsp.layout("splitratio 0.67 exact"))
	end
end

hl.on("window.open", function(window)
	apply_portrait_split(window.workspace)
end)

hl.on("window.close", function(window)
	apply_portrait_split(window.workspace)
end)

hl.on("window.move_to_workspace", function(_, workspace)
	apply_portrait_split(workspace)
end)

for _, window in ipairs(hl.get_windows()) do
	apply_portrait_split(window.workspace)
end

local active_window = require("lib.window").active

local M = {}

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

local function dispatch_on_window(window, dispatcher)
	local target = address(window)
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

local function dispatch_on_workspace(workspace, dispatcher)
	local windows = tiled_windows(workspace)
	if not windows[1] then
		return
	end

	dispatch_on_window(windows[1], dispatcher)
end

local function apply_portrait_split(workspace, changed_window)
	if not workspace or not workspace.monitor or workspace.monitor.name ~= "HDMI-A-2" or not workspace.active then
		return
	end

	if workspace.tiled_layout ~= "dwindle" then
		return
	end

	local count = tiled_count(workspace)
	if count == 2 then
		dispatch_on_workspace(workspace, hl.dsp.layout("splitratio 0.67 exact"))
	elseif count == 3 then
		dispatch_on_window(changed_window or tiled_windows(workspace)[3], hl.dsp.layout("splitratio 1.0 exact"))
	end
end

function M.apply_all()
	for _, window in ipairs(hl.get_windows()) do
		apply_portrait_split(window.workspace)
	end
end

hl.on("window.open", function(window)
	apply_portrait_split(window.workspace, window)
end)

hl.on("window.close", function(window)
	apply_portrait_split(window.workspace)
end)

hl.on("window.move_to_workspace", function(_, workspace)
	apply_portrait_split(workspace, active_window())
end)

hl.on("workspace.move_to_monitor", function(workspace)
	apply_portrait_split(workspace)
end)

hl.on("window.active", function(window, active)
	if active == 1 then
		apply_portrait_split(window.workspace)
	end
end)

M.apply_all()

return M

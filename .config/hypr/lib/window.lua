local M = {}

local directions = {
	l = "left",
	r = "right",
	u = "up",
	d = "down",
	left = "left",
	right = "right",
	up = "up",
	down = "down",
}

local deltas = {
	left = { x = -32, y = 0 },
	right = { x = 32, y = 0 },
	up = { x = 0, y = -32 },
	down = { x = 0, y = 32 },
}

local function direction(value)
	local normalized = directions[value]
	if not normalized then
		error("unknown window direction: " .. tostring(value))
	end

	return normalized
end

local function dispatch(dispatcher)
	hl.dispatch(dispatcher)
end

function M.active()
	if hl.get_active_window then
		return hl.get_active_window()
	end

	for _, window in ipairs(hl.get_windows()) do
		if window.active then
			return window
		end
	end

	return nil
end

function M.focus(value)
	return hl.dsp.focus({ direction = direction(value) })
end

function M.move(value)
	local normalized = direction(value)

	return function()
		local active = M.active()
		local monitor = active and active.monitor and active.monitor.name or nil

		if normalized == "right" and monitor == "HDMI-A-2" then
			dispatch(hl.dsp.window.move({ monitor = "DP-2" }))
			return
		end

		if (normalized == "up" or normalized == "down") and monitor == "HDMI-A-2" then
			dispatch(hl.dsp.window.swap({ direction = normalized }))
			return
		end

		dispatch(hl.dsp.window.move({ direction = normalized }))
	end
end

function M.adjust(kind, value)
	local delta = deltas[direction(value)]
	if kind == "nudge" then
		return hl.dsp.window.move({ x = delta.x, y = delta.y, relative = true })
	end

	if kind == "resize" then
		return hl.dsp.window.resize({ x = delta.x, y = delta.y, relative = true })
	end

	error("unknown window adjustment: " .. tostring(kind))
end

return M

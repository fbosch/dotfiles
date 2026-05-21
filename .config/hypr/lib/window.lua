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

local dispatch = hl.dispatch
local warp_command = "~/.config/hypr/runtime/windows/warp-cursor-to-active-window.sh"
local warp_active = hl.dsp.exec_cmd(warp_command)
local warp_active_after_focus = hl.dsp.exec_cmd(warp_command .. " 0.03")

local function direction(value)
	local normalized = directions[value]
	if not normalized then
		error("unknown window direction: " .. tostring(value))
	end

	return normalized
end

local function active_monitor_name()
	local active = M.active()
	return active and active.monitor and active.monitor.name or nil
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
	local normalized = direction(value)
	local focus_dispatcher = hl.dsp.focus({ direction = normalized })

	return function()
		dispatch(focus_dispatcher)
		dispatch(warp_active_after_focus)
	end
end

function M.move(value)
	local normalized = direction(value)
	local move_dispatcher = hl.dsp.window.move({ direction = normalized })
	local move_to_portrait = hl.dsp.window.move({ monitor = "HDMI-A-2" })
	local move_to_ultrawide = hl.dsp.window.move({ monitor = "DP-2" })
	local swap_dispatcher = hl.dsp.window.swap({ direction = normalized })

	if normalized == "right" then
		return function()
			if active_monitor_name() == "HDMI-A-2" then
				dispatch(move_to_ultrawide)
			else
				dispatch(move_dispatcher)
			end
			dispatch(warp_active)
		end
	end

	if normalized == "down" then
		return function()
			local monitor = active_monitor_name()
			if monitor == "DP-2" then
				dispatch(move_to_portrait)
			elseif monitor == "HDMI-A-2" then
				dispatch(swap_dispatcher)
			else
				dispatch(move_dispatcher)
			end
			dispatch(warp_active)
		end
	end

	if normalized == "up" then
		return function()
			if active_monitor_name() == "HDMI-A-2" then
				dispatch(swap_dispatcher)
			else
				dispatch(move_dispatcher)
			end
			dispatch(warp_active)
		end
	end

	return function()
		dispatch(move_dispatcher)
		dispatch(warp_active)
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

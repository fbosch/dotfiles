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

local function warp_cursor_to_active(delay)
	if delay == "0.03" then
		dispatch(warp_active_after_focus)
		return
	end

	if not delay then
		dispatch(warp_active)
		return
	end

	dispatch(hl.dsp.exec_cmd(warp_command .. " " .. delay))
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
		warp_cursor_to_active("0.03")
	end
end

function M.move(value)
	local normalized = direction(value)
	local move_dispatcher = hl.dsp.window.move({ direction = normalized })
	local move_to_ultrawide = hl.dsp.window.move({ monitor = "DP-2" })
	local swap_dispatcher = hl.dsp.window.swap({ direction = normalized })

	return function()
		local active = M.active()
		local monitor = active and active.monitor and active.monitor.name or nil

		if normalized == "right" and monitor == "HDMI-A-2" then
			dispatch(move_to_ultrawide)
			warp_cursor_to_active()
			return
		end

		if (normalized == "up" or normalized == "down") and monitor == "HDMI-A-2" then
			dispatch(swap_dispatcher)
			warp_cursor_to_active()
			return
		end

		dispatch(move_dispatcher)
		warp_cursor_to_active()
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

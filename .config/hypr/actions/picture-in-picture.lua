local pip = require("lib.picture_in_picture")
local async = require("lib.async")
local command = require("lib.command")
local hypr_ipc = require("runtime.lib.hypr-ipc")

local M = {}

local control_socket = "nc -U " .. command.arg(hypr_ipc.instance_socket_path("pip-monitor.sock")) .. " >/dev/null 2>&1"
local dragging = false
local resizing = false
local warp_active_after_focus = async.runtime_lua("windows/warp-cursor-to-active-window.lua", "--delay", "0.03")

local function notify(line)
	hl.dispatch(hl.dsp.exec_cmd("printf '%s\\n' " .. command.arg(line) .. " | " .. control_socket))
end

local function active_pip()
	local active = hl.get_active_window and hl.get_active_window()
	if active and active.class == pip.class and active.title == pip.title and active.address then
		return active
	end
end

function M.drag()
	local active = active_pip()
	if active then
		dragging = true
		notify(pip.control.encode("drag-start", active.address))
	else
		notify(pip.control.encode("drag-cancel"))
	end

	hl.dispatch(hl.dsp.window.drag())
end

function M.finish_drag()
	if dragging then
		notify(pip.control.encode("drag-end"))
	else
		notify(pip.control.encode("drag-cancel"))
	end

	dragging = false
end

function M.start_resize(keep_aspect_ratio)
	if not active_pip() then
		return false
	end

	resizing = true
	notify(pip.control.encode("resize-start"))
	if keep_aspect_ratio then
		hl.dispatch(hl.dsp.window.set_prop({ prop = "keep_aspect_ratio", value = "1" }))
	end
	hl.dispatch(hl.dsp.window.resize())
	return true
end

function M.finish_resize(keep_aspect_ratio)
	if resizing == false then
		return false
	end

	if keep_aspect_ratio then
		hl.dispatch(hl.dsp.window.set_prop({ prop = "keep_aspect_ratio", value = "0" }))
	end
	notify(pip.control.encode("resize-end"))
	resizing = false
	return true
end

function M.move_corner(direction)
	local active = active_pip()
	if not active then
		return false
	end

	notify(pip.control.encode("move", active.address, direction))
	return true
end

function M.focus(direction)
	local active = active_pip()
	if not active then
		return false
	end

	local at = active.at
	local size = active.size
	if not at or not size then
		return false
	end

	local origin_x = at.x + size.x / 2
	local origin_y = at.y + size.y / 2
	local nearest = nil
	local nearest_distance = math.huge
	for _, window in ipairs(hl.get_windows()) do
		local window_at = window.at
		local window_size = window.size
		if window.visible ~= false and window.floating == false and window_at and window_size then
			local x = window_at.x + window_size.x / 2
			local y = window_at.y + window_size.y / 2
			local horizontal = x - origin_x
			local vertical = y - origin_y
			local matches = (direction == "left" and horizontal < 0)
				or (direction == "right" and horizontal > 0)
				or (direction == "up" and vertical < 0)
				or (direction == "down" and vertical > 0)
			if matches then
				local distance = horizontal * horizontal + vertical * vertical
				if distance < nearest_distance then
					nearest = window
					nearest_distance = distance
				end
			end
		end
	end

	if not nearest then
		return false
	end

	hl.dispatch(hl.dsp.focus({ window = nearest }))
	hl.dispatch(warp_active_after_focus)
	return true
end

return M

local M = {}
local monitor_role = require("lib.monitor_role")
local order_state = require("layouts.shared.order_state")

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
local custom_layout_resize_command = "~/.config/hypr/runtime/windows/daemons/custom-layout-drag-resize/custom-layout-drag-resize.sh"
local warp_active = hl.dsp.exec_cmd(warp_command)
local warp_active_after_focus = hl.dsp.exec_cmd(warp_command .. " 0.03")
local portrait_resize_up = hl.dsp.layout("resize-up")
local portrait_resize_down = hl.dsp.layout("resize-down")
local portrait_swap_up = hl.dsp.layout("swapprev")
local portrait_swap_down = hl.dsp.layout("swapnext")
local ultrawide_swap_left = hl.dsp.layout("swapprev")
local ultrawide_swap_right = hl.dsp.layout("swapnext")
local ultrawide_resize_left = hl.dsp.layout("resize-left")
local ultrawide_resize_right = hl.dsp.layout("resize-right")
local ultrawide_x = 1440
local edge_tolerance = 64
local pinned_workspace = "1"
local pinned_workspace_monitor = "HDMI-A-2"
local gaming_workspace = "10"
local portrait_transfer_end = { monitor_role = monitor_role.portrait, axis = "y", edge = "end" }
local ultrawide_transfer_start = { monitor_role = monitor_role.ultrawide, axis = "x", edge = "start" }

local function expected_layout(role)
	if role == monitor_role.portrait then
		return "lua:portrait_rows"
	end

	if role == monitor_role.ultrawide then
		return "lua:ultrawide_master"
	end

	return nil
end

local function uses_custom_layout(active, expected)
	local workspace = active and active.workspace
	local layout = workspace and (workspace.tiledLayout or workspace.layout)
	local expected_name = expected_layout(expected)
	if layout or not expected_name then
		return layout == expected_name
	end

	local name = workspace and tostring(workspace.name or workspace.id) or nil
	if not name or name == "10" or name:match("^special:") then
		return false
	end

	local role = monitor_role.for_window(active)
	if expected == monitor_role.portrait then
		return role == monitor_role.portrait
	end

	if expected == monitor_role.ultrawide then
		return role == monitor_role.ultrawide
	end

	return false
end

function M.uses_any_custom_layout(active)
	return uses_custom_layout(active, monitor_role.portrait) or uses_custom_layout(active, monitor_role.ultrawide)
end

local function direction(value)
	local normalized = directions[value]
	if not normalized then
		error("unknown window direction: " .. tostring(value))
	end

	return normalized
end

local function monitor_x(active)
	local monitor = active and active.monitor
	return monitor and (monitor.x or (monitor.at and monitor.at.x)) or nil
end

local function on_ultrawide_left_edge(active)
	local at = active and active.at
	local x = at and at.x
	if not x then
		return false
	end

	return x <= (monitor_x(active) or ultrawide_x) + edge_tolerance
end

local function tiled_count(workspace)
	if not workspace or not workspace.get_windows then
		return nil
	end

	local count = 0
	local windows = workspace:get_windows()
	for index = 1, #windows do
		local window = windows[index]
		if window.visible ~= false and not window.floating then
			count = count + 1
			if count > 1 then
				return count
			end
		end
	end

	return count
end

local function is_only_tiled_window(active)
	return tiled_count(active and active.workspace) == 1
end

local function warp_window(active)
	local at = active and active.at or nil
	local size = active and active.size or nil
	if not at or not size or not at.x or not at.y or not size.x or not size.y then
		dispatch(warp_active)
		return
	end

	dispatch(hl.dsp.cursor.move({ x = at.x + size.x / 2, y = at.y + size.y / 2 }))
end

local function custom_layout_resize(action)
	return hl.dsp.exec_cmd(custom_layout_resize_command .. " " .. action)
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

local function pin_workspace_one()
	dispatch(hl.dsp.workspace.move({ workspace = pinned_workspace, monitor = pinned_workspace_monitor }))
end

function M.focus_workspace(workspace)
	if workspace == pinned_workspace then
		pin_workspace_one()
		dispatch(hl.dsp.focus({ monitor = pinned_workspace_monitor }))
	end

	dispatch(hl.dsp.focus({ workspace = workspace }))
end

function M.move_to_workspace(workspace)
	if workspace == pinned_workspace then
		pin_workspace_one()
	end

	dispatch(hl.dsp.window.move({ workspace = workspace }))
end

function M.move_to_gaming_workspace()
	M.move_to_workspace(gaming_workspace)
end

function M.hide_from_current_workspace()
	dispatch(hl.dsp.window.move({ workspace = "+0", follow = false }))
end

function M.place_custom_layout_at_cursor()
	if M.uses_any_custom_layout(M.active()) then
		dispatch(hl.dsp.layout("place-at-cursor"))
	end
end

function M.start_custom_layout_resize()
	M.reset_keep_aspect_ratio()
	dispatch(custom_layout_resize("start"))
end

function M.stop_custom_layout_resize()
	dispatch(custom_layout_resize("stop"))
end

function M.resize_keep_aspect_ratio()
	dispatch(custom_layout_resize("stop"))
	dispatch(hl.dsp.window.set_prop({ prop = "keep_aspect_ratio", value = "1" }))
	dispatch(hl.dsp.window.resize())
end

function M.reset_keep_aspect_ratio()
	dispatch(hl.dsp.window.set_prop({ prop = "keep_aspect_ratio", value = "0" }))
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
	local move_to_portrait = hl.dsp.window.move({ monitor = monitor_role.name_for(monitor_role.portrait) })
	local move_to_ultrawide = hl.dsp.window.move({ monitor = monitor_role.name_for(monitor_role.ultrawide) })

	if normalized == "right" then
		return function()
			local active = M.active()
			if uses_custom_layout(active, monitor_role.portrait) then
				order_state.record_transfer_intent(active, ultrawide_transfer_start)
				dispatch(move_to_ultrawide)
			elseif uses_custom_layout(active, monitor_role.ultrawide) then
				dispatch(ultrawide_swap_right)
			else
				dispatch(move_dispatcher)
			end
			warp_window(active)
		end
	end

	if normalized == "down" then
		return function()
			local active = M.active()
			if uses_custom_layout(active, monitor_role.ultrawide) then
				order_state.record_transfer_intent(active, portrait_transfer_end)
				dispatch(move_to_portrait)
			elseif uses_custom_layout(active, monitor_role.portrait) then
				dispatch(portrait_swap_down)
			else
				dispatch(move_dispatcher)
			end
			warp_window(active)
		end
	end

	if normalized == "up" then
		return function()
			local active = M.active()
			if uses_custom_layout(active, monitor_role.portrait) then
				dispatch(portrait_swap_up)
			else
				dispatch(move_dispatcher)
			end
			warp_window(active)
		end
	end

	if normalized == "left" then
		return function()
			local active = M.active()
			if uses_custom_layout(active, monitor_role.ultrawide) then
				if is_only_tiled_window(active) or on_ultrawide_left_edge(active) then
					order_state.record_transfer_intent(active, portrait_transfer_end)
					dispatch(move_to_portrait)
				else
					dispatch(ultrawide_swap_left)
				end
			else
				dispatch(move_dispatcher)
			end
			warp_window(active)
		end
	end

	return function()
		local active = M.active()
		dispatch(move_dispatcher)
		warp_window(active)
	end
end

function M.adjust(kind, value)
	local delta = deltas[direction(value)]
	if kind == "nudge" then
		return hl.dsp.window.move({ x = delta.x, y = delta.y, relative = true })
	end

	if kind == "resize" then
		if delta.x ~= 0 then
			return function()
				local active = M.active()
				if uses_custom_layout(active, monitor_role.ultrawide) then
					dispatch(delta.x < 0 and ultrawide_resize_left or ultrawide_resize_right)
					return
				end

				dispatch(hl.dsp.window.resize({ x = delta.x, y = delta.y, relative = true }))
			end
		end

		if delta.y ~= 0 then
			return function()
				local active = M.active()
				if uses_custom_layout(active, monitor_role.portrait) then
					dispatch(delta.y < 0 and portrait_resize_up or portrait_resize_down)
					return
				end

				dispatch(hl.dsp.window.resize({ x = delta.x, y = delta.y, relative = true }))
			end
		end

		return hl.dsp.window.resize({ x = delta.x, y = delta.y, relative = true })
	end

	error("unknown window adjustment: " .. tostring(kind))
end

return M

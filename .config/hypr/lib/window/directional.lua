local async = require("lib.async")
local monitor_role = require("lib.monitor_role")
local intents = require("layouts.shared.intents")
local pip = require("lib.picture_in_picture")
local picture_in_picture = require("actions.picture-in-picture")

local M = {}
local dispatch = hl.dispatch
local warp_active = async.runtime_lua("windows/warp-cursor-to-active-window.lua")
local warp_active_after_focus = async.runtime_lua("windows/warp-cursor-to-active-window.lua", "--delay", "0.03")
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
	if normalized == nil then
		error("unknown window direction: " .. tostring(value))
	end

	return normalized
end

local function delta(value)
	return deltas[direction(value)]
end

--- One-shot placement request consumed when a window enters a custom layout.
---@class TransferIntent
---@field monitor_role string Target monitor role.
---@field axis "x"|"y" Layout axis that consumes the request.
---@field edge "start"|"end" Insertion edge on that axis.

---@type TransferIntent
local portrait_transfer_end = { monitor_role = monitor_role.portrait, axis = "y", edge = "end" }
---@type TransferIntent
local ultrawide_transfer_start = { monitor_role = monitor_role.ultrawide, axis = "x", edge = "start" }

local window_behaviors = {
	{
		matches = function(window)
			return window.class == pip.class and window.title == pip.title
		end,
		focus = picture_in_picture.focus,
		move = picture_in_picture.move_corner,
	},
}

local function monitor_x(active)
	local monitor = active and active.monitor
	return monitor and (monitor.x or (monitor.at and monitor.at.x)) or nil
end

local function on_ultrawide_left_edge(active)
	local at = active and active.at
	local x = at and at.x
	if x == nil then
		return false
	end

	return x <= (monitor_x(active) or ultrawide_x) + edge_tolerance
end

local function is_only_tiled_window(active)
	local workspace = active and active.workspace
	if workspace == nil or workspace.get_windows == nil then
		return false
	end

	local count = 0
	for _, window in ipairs(workspace:get_windows()) do
		if window.visible ~= false and not window.floating then
			count = count + 1
			if count > 1 then
				return false
			end
		end
	end

	return count == 1
end

local function warp_window(active)
	local at = active and active.at
	local size = active and active.size
	if at == nil or size == nil or at.x == nil or at.y == nil or size.x == nil or size.y == nil then
		dispatch(warp_active)
		return
	end

	dispatch(hl.dsp.cursor.move({ x = at.x + size.x / 2, y = at.y + size.y / 2 }))
end

local function monitor_geometry(monitor)
	local at = monitor and (monitor.at or monitor)
	local size = monitor and monitor.size
	local width = monitor and (monitor.width or (size and size.x))
	local height = monitor and (monitor.height or (size and size.y))
	if at == nil or width == nil or height == nil or at.x == nil or at.y == nil then
		return nil
	end

	if monitor.transform == 1 or monitor.transform == 3 then
		width, height = height, width
	end

	return { x = at.x, y = at.y, width = width, height = height }
end

local function monitor_by_role(role)
	if hl.get_monitors == nil then
		return nil
	end

	local name = monitor_role.name_for(role)
	for _, monitor in ipairs(hl.get_monitors()) do
		if monitor.name == name then
			return monitor_geometry(monitor)
		end
	end

	return nil
end

local function clamp(value, minimum, maximum)
	return math.min(math.max(value, minimum), maximum)
end

local function move_floating_to_monitor(active, role, dispatcher)
	local source = monitor_by_role(monitor_role.for_window(active))
	local destination = monitor_by_role(role)
	local at = active and active.at
	local size = active and active.size
	if source == nil or destination == nil or at == nil or size == nil or size.x == nil or size.y == nil then
		dispatch(dispatcher)
		return
	end

	local x_fraction = (at.x - source.x) / source.width
	local y_fraction = (at.y - source.y) / source.height
	local x = destination.x + clamp(x_fraction * destination.width, 0, math.max(0, destination.width - size.x))
	local y = destination.y + clamp(y_fraction * destination.height, 0, math.max(0, destination.height - size.y))
	dispatch(dispatcher)
	dispatch(hl.dsp.window.move({ x = x, y = y }))
end

local function directional_candidate(active, direction, candidates, expected_role)
	local at = active.at
	local size = active.size
	if at == nil or size == nil or at.x == nil or at.y == nil or size.x == nil or size.y == nil then
		return nil
	end

	local origin_x = at.x + size.x / 2
	local origin_y = at.y + size.y / 2
	local nearest = nil
	local nearest_distance = math.huge
	for _, window in ipairs(candidates) do
		local window_at = window.at
		local window_size = window.size
		if
			window ~= active
			and window.visible ~= false
			and (expected_role == nil or monitor_role.for_window(window) == expected_role)
			and window_at
			and window_size
			and window_at.x
			and window_at.y
			and window_size.x
			and window_size.y
		then
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

	return nearest
end

local function workspace_candidate(active, direction)
	local workspace = active and active.workspace
	if workspace == nil or workspace.get_windows == nil then
		return nil
	end

	return directional_candidate(active, direction, workspace:get_windows())
end

local function monitor_candidate(state, active, direction)
	local destination_role = nil
	if direction == "right" and state.uses_custom_layout(active, monitor_role.portrait) then
		destination_role = monitor_role.ultrawide
	elseif direction == "left" and state.uses_custom_layout(active, monitor_role.ultrawide) then
		destination_role = monitor_role.portrait
	end

	if destination_role == nil or hl.get_windows == nil then
		return nil
	end

	return directional_candidate(active, direction, hl.get_windows(), destination_role)
end

local function with_window_behavior(state, action, direction, fallback)
	return function()
		local active = state.active()
		if active then
			for _, behavior in ipairs(window_behaviors) do
				local handler = behavior[action]
				if handler and behavior.matches(active) then
					local handled = handler(direction)
					if handled ~= false then
						return handled
					end
				end
			end
		end

		return fallback()
	end
end

function M.focus(state, value)
	local normalized = direction(value)
	local focus_dispatcher = hl.dsp.focus({ direction = normalized })
	return with_window_behavior(state, "focus", normalized, function()
		local active = state.active()
		if state.uses_any_custom_layout(active) then
			local candidate = workspace_candidate(active, normalized)
			candidate = candidate or monitor_candidate(state, active, normalized)
			if candidate then
				dispatch(hl.dsp.focus({ window = candidate }))
				dispatch(warp_active_after_focus)
				return
			end
		end

		dispatch(focus_dispatcher)
		dispatch(warp_active_after_focus)
	end)
end

function M.move(state, value)
	local normalized = direction(value)
	local move_dispatcher = hl.dsp.window.move({ direction = normalized })
	local move_to_portrait = hl.dsp.window.move({ monitor = monitor_role.name_for(monitor_role.portrait) })
	local move_to_ultrawide = hl.dsp.window.move({ monitor = monitor_role.name_for(monitor_role.ultrawide) })

	local function move_window()
		local active = state.active()
		if active and active.floating then
			if normalized == "right" and state.uses_custom_layout(active, monitor_role.portrait) then
				move_floating_to_monitor(active, monitor_role.ultrawide, move_to_ultrawide)
			elseif normalized == "left" and state.uses_custom_layout(active, monitor_role.ultrawide) then
				move_floating_to_monitor(active, monitor_role.portrait, move_to_portrait)
			else
				dispatch(move_dispatcher)
			end
		elseif normalized == "right" and state.uses_custom_layout(active, monitor_role.portrait) then
			intents.record_transfer_intent(active, ultrawide_transfer_start)
			dispatch(move_to_ultrawide)
		elseif normalized == "right" and state.uses_custom_layout(active, monitor_role.ultrawide) then
			dispatch(ultrawide_swap_right)
		elseif normalized == "down" and state.uses_custom_layout(active, monitor_role.ultrawide) then
			intents.record_transfer_intent(active, portrait_transfer_end)
			dispatch(move_to_portrait)
		elseif normalized == "down" and state.uses_custom_layout(active, monitor_role.portrait) then
			dispatch(portrait_swap_down)
		elseif normalized == "up" and state.uses_custom_layout(active, monitor_role.portrait) then
			dispatch(portrait_swap_up)
		elseif normalized == "left" and state.uses_custom_layout(active, monitor_role.ultrawide) then
			if is_only_tiled_window(active) or on_ultrawide_left_edge(active) then
				intents.record_transfer_intent(active, portrait_transfer_end)
				dispatch(move_to_portrait)
			else
				dispatch(ultrawide_swap_left)
			end
		else
			dispatch(move_dispatcher)
		end
		warp_window(active)
	end

	return with_window_behavior(state, "move", normalized, move_window)
end

function M.adjust(state, kind, value)
	local delta = delta(value)
	if kind == "nudge" then
		return hl.dsp.window.move({ x = delta.x, y = delta.y, relative = true })
	end

	if kind ~= "resize" then
		error("unknown window adjustment: " .. tostring(kind))
	end

	if delta.x ~= 0 then
		return function()
			if state.uses_custom_layout(state.active(), monitor_role.ultrawide) then
				dispatch(delta.x < 0 and ultrawide_resize_left or ultrawide_resize_right)
				return
			end

			dispatch(hl.dsp.window.resize({ x = delta.x, y = delta.y, relative = true }))
		end
	end

	return function()
		if state.uses_custom_layout(state.active(), monitor_role.portrait) then
			dispatch(delta.y < 0 and portrait_resize_up or portrait_resize_down)
			return
		end

		dispatch(hl.dsp.window.resize({ x = delta.x, y = delta.y, relative = true }))
	end
end

return M

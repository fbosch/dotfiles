local M = {}
local order_state = require("layouts.order_state")
local box = {}
local state = order_state.new()
local min_ratio = 0.15
local resize_step = 0.05
local ratios_two = { 0.67, 0.33 }
local ratios_three = { 0.3, 0.4, 0.3 }
local fallback_ratios = {}
local ratios_by_workspace = {}

local function monitor_name(targets)
	for index = 1, #targets do
		local window = targets[index].window
		local monitor = window and window.monitor
		if monitor and monitor.name then
			return monitor.name
		end
	end

	return nil
end

local function workspace_key(targets)
	for index = 1, #targets do
		local window = targets[index].window
		local workspace = window and window.workspace
		if workspace then
			return workspace.id or workspace.name
		end
	end

	return nil
end

local function active_index(targets)
	for index = 1, #targets do
		local window = targets[index].window
		if window and window.active then
			return index
		end
	end

	return 1
end

local function horizontal_center(target)
	local window = target and target.window
	local at = window and window.at
	local size = window and window.size
	local x = at and at.x
	if not x then
		return nil
	end

	local width = size and size.x or 0
	return x + width / 2
end

local function ratios_for(count)
	if count == 2 then
		return ratios_two
	end

	if count == 3 then
		return ratios_three
	end

	for index = 1, count do
		fallback_ratios[index] = 1 / count
	end
	for index = count + 1, #fallback_ratios do
		fallback_ratios[index] = nil
	end

	return fallback_ratios
end

local function ratios_for_workspace(key, count)
	local ratios = key and ratios_by_workspace[key] or nil
	if not ratios or #ratios ~= count then
		local defaults = ratios_for(count)
		ratios = {}
		for index = 1, count do
			ratios[index] = defaults[index]
		end
		if key then
			ratios_by_workspace[key] = ratios
		end
	end

	return ratios
end

local function clamp_delta(first, second, delta)
	if delta > 0 then
		return math.min(delta, second - min_ratio)
	end

	return math.max(delta, min_ratio - first)
end

local function adjust_boundary(ratios, first_index, delta)
	local second_index = first_index + 1
	if not ratios[first_index] or not ratios[second_index] then
		return
	end

	delta = clamp_delta(ratios[first_index], ratios[second_index], delta)
	ratios[first_index] = ratios[first_index] + delta
	ratios[second_index] = ratios[second_index] - delta
end

local function adjust_active(ratios, index, count, delta)
	if delta > 0 then
		if index < count then
			adjust_boundary(ratios, index, delta)
		else
			adjust_boundary(ratios, index - 1, delta)
		end
	elseif index > 1 then
		adjust_boundary(ratios, index - 1, delta)
	else
		adjust_boundary(ratios, index, delta)
	end
end

local function desired_index(center, ratios, area_x, area_width)
	if not center then
		return nil
	end

	local offset = center - area_x
	local boundary = 0
	for index = 1, #ratios do
		boundary = boundary + area_width * ratios[index]
		if offset < boundary then
			return index
		end
	end

	return #ratios
end

local function move_active_to_position(targets, key, ratios, area_x, area_width)
	local active = active_index(targets)
	local target_index = desired_index(horizontal_center(targets[active]), ratios, area_x, area_width)
	if not target_index or target_index == active then
		return
	end

	order_state.move_active_to_index(state, key, targets, active_index, target_index)
end

local function move_active(targets, key, delta)
	order_state.move_active(state, key, targets, active_index, delta)
end

local function place_columns(targets, ratios, x, y, width, height)
	local next_x = x
	box.y = y
	box.h = height

	for index = 1, #targets do
		box.x = next_x
		box.w = width * ratios[index]
		if index == #targets then
			box.w = x + width - next_x
		end

		targets[index]:place(box)
		next_x = next_x + box.w
	end
end

function M.recalculate(ctx)
	local targets = ctx.targets
	if not targets then
		return
	end

	local count = #targets
	if count == 0 then
		return
	end

	local area = ctx.area
	if count == 1 then
		targets[1]:place(area)
		return
	end

	local x = area.x
	local y = area.y
	local width = area.w
	local height = area.h
	local ratios = ratios_for_workspace(workspace_key(targets), count)

	if monitor_name(targets) ~= "DP-2" then
		place_columns(targets, ratios, x, y, width, height)
		return
	end

	local key = workspace_key(targets)
	local skip_position_order = state.skip_position_by_key[key]
	local source_targets = targets
	local order, targets_by_id = order_state.sync(state, key, source_targets)
	targets = order_state.targets_from_order(state, key, order, targets_by_id, source_targets)
	if skip_position_order then
		state.skip_position_by_key[key] = nil
	else
		move_active_to_position(targets, key, ratios, x, width)
		targets = order_state.targets_from_order(state, key, order, targets_by_id, source_targets)
	end

	place_columns(targets, ratios, x, y, width, height)
end

function M.layout_msg(ctx, msg)
	local targets = ctx.targets
	local count = targets and #targets or 0
	if count < 2 then
		return true
	end

	local command = msg:match("^(%S+)")
	local key = workspace_key(targets)
	local order, targets_by_id = order_state.sync(state, key, targets)
	targets = order_state.targets_from_order(state, key, order, targets_by_id, targets)
	local ratios = ratios_for_workspace(key, count)
	local index = active_index(targets)

	if command == "swapprev" then
		move_active(targets, key, -1)
	elseif command == "swapnext" then
		move_active(targets, key, 1)
	elseif command == "resize-left" then
		adjust_active(ratios, index, count, -resize_step)
	elseif command == "resize-right" then
		adjust_active(ratios, index, count, resize_step)
	elseif command == "reset" then
		if key then
			ratios_by_workspace[key] = nil
		end
	else
		return true
	end

	return true
end

hl.layout.register("ultrawide_master", {
	recalculate = M.recalculate,
	layout_msg = M.layout_msg,
})

return M

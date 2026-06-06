local M = {}
local order_state = require("layouts.order_state")
local resize_state = require("layouts.resize_state")
local one_third = 1 / 3
local min_ratio = 0.15
local resize_step = 0.05
local box = {}
local ratios_by_workspace = {}
local state = order_state.new()

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

	return monitor_name(targets)
end

local function order_key(targets)
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

local function vertical_center(target)
	local window = target and target.window
	local at = window and window.at
	local size = window and window.size
	local y = at and at.y
	if not y then
		return nil
	end

	local height = size and size.y or 0
	return y + height / 2
end

local function move_active(targets, key, delta)
	order_state.move_active(state, key, targets, active_index, delta)
end

local function desired_index(center, ratios, area_y, area_height)
	if not center then
		return nil
	end

	local offset = center - area_y
	local boundary = 0
	for index = 1, #ratios do
		boundary = boundary + area_height * ratios[index]
		if offset < boundary then
			return index
		end
	end

	return #ratios
end

local function move_active_to_position(targets, key, ratios, area_y, area_height)
	local active = active_index(targets)
	local center = vertical_center(targets[active])
	local target_index = desired_index(center, ratios, area_y, area_height)
	if not target_index or target_index == active then
		return
	end

	order_state.move_active_to_index(state, key, targets, active_index, target_index)
end

local function default_ratios(count)
	local ratios = {}

	if count == 2 then
		ratios[1] = one_third
		ratios[2] = 1 - one_third
		return ratios
	end

	for index = 1, count do
		ratios[index] = 1 / count
	end

	return ratios
end

local function ratios_for(key, count)
	local ratios = key and ratios_by_workspace[key] or nil
	if not ratios or #ratios ~= count then
		ratios = default_ratios(count)
		if key then
			ratios_by_workspace[key] = ratios
		end
	end

	return ratios
end

local function place_rows(targets, count, x, y, width, height)
	local row_height = height / count
	box.x = x
	box.w = width
	box.h = row_height

	for index = 1, count do
		box.y = y + row_height * (index - 1)
		targets[index]:place(box)
	end
end

local function place_ratio_rows(targets, ratios, x, y, width, height)
	local next_y = y
	box.x = x
	box.w = width

	for index = 1, #targets do
		box.y = next_y
		box.h = height * ratios[index]
		if index == #targets then
			box.h = y + height - next_y
		end

		targets[index]:place(box)
		next_y = next_y + box.h
	end
end

function M.recalculate(ctx)
	local targets = ctx.targets
	if not targets then
		return
	end

	local key = order_key(targets)
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

	if monitor_name(targets) ~= "HDMI-A-2" then
		place_rows(targets, count, x, y, width, height)
		return
	end

	local skip_position_order = state.skip_position_by_key[key]
	local ratios = ratios_for(workspace_key(targets), count)
	local source_targets = targets
	local order, targets_by_id = order_state.sync(state, key, source_targets)
	targets = order_state.targets_from_order(state, key, order, targets_by_id, source_targets)
	if skip_position_order then
		state.skip_position_by_key[key] = nil
	else
		move_active_to_position(targets, key, ratios, y, height)
		targets = order_state.targets_from_order(state, key, order, targets_by_id, source_targets)
	end

	box.x = x
	box.y = y
	box.w = width
	box.h = height

	if count == 2 or count == 3 then
		place_ratio_rows(targets, ratios, x, y, width, height)
		return
	end

	place_rows(targets, count, x, y, width, height)
end

function M.resize(ctx, target, delta, corner)
	local targets = ctx.targets
	local count = targets and #targets or 0
	if count < 2 or count > 3 then
		return true
	end

	local key = order_key(targets)
	local ratio_key = workspace_key(targets)
	local order, targets_by_id = order_state.sync(state, key, targets)
	targets = order_state.targets_from_order(state, key, order, targets_by_id, targets)

	local area = ctx.area
	local ratios = ratios_for(ratio_key, count)
	local amount = resize_state.delta_ratio(delta, "y", area and area.h, resize_step)
	local index = resize_state.target_index(targets, target, active_index)
	resize_state.adjust_active(ratios, index, count, amount, min_ratio)
	if key then
		state.skip_position_by_key[key] = true
	end

	return true
end

function M.layout_msg(ctx, msg)
	local targets = ctx.targets
	local count = targets and #targets or 0
	if count < 2 or count > 3 then
		return true
	end

	local command = msg:match("^(%S+)")
	local key = order_key(targets)
	local ratio_key = workspace_key(targets)
	local order, targets_by_id = order_state.sync(state, key, targets)
	targets = order_state.targets_from_order(state, key, order, targets_by_id, targets)

	if command == "resize-up" then
		M.resize(ctx, nil, { y = -resize_step }, nil)
	elseif command == "resize-down" then
		M.resize(ctx, nil, { y = resize_step }, nil)
	elseif command == "resize-y" then
		M.resize(ctx, nil, { y = tonumber(msg:match("^%S+%s+(-?%d+%.?%d*)")) or 0 }, nil)
	elseif command == "resize-y-at" then
		local edge, position = msg:match("^%S+%s+(%S+)%s+(-?%d+%.?%d*)")
		local area = ctx.area
		local ratios = ratios_for(ratio_key, count)
		local index = active_index(targets)
		local boundary = resize_state.boundary_for_edge(index, count, edge)
		resize_state.set_boundary_at(ratios, boundary, tonumber(position), area and area.y, area and area.h, min_ratio)
		if key then
			state.skip_position_by_key[key] = true
		end
	elseif command == "reset" then
		if ratio_key then
			ratios_by_workspace[ratio_key] = default_ratios(count)
		end
	elseif command == "swapprev" then
		move_active(targets, key, -1)
	elseif command == "swapnext" then
		move_active(targets, key, 1)
	else
		return true
	end

	return true
end

hl.layout.register("portrait_rows", {
	recalculate = M.recalculate,
	layout_msg = M.layout_msg,
	resize = M.resize,
})

return M

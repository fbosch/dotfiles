local M = {}
local order_state = require("layouts.order_state")
local resize_state = require("layouts.resize_state")
local box = {}
local state = order_state.new()
local min_ratio = 0.15
local resize_step = 0.05
local ratios_two = { 0.67, 0.33 }
local ratios_three = { 0.3, 0.4, 0.3 }
local fallback_ratios = {}
local ratios_by_workspace = {}
local row_ratios_by_workspace = {}

local function default_row_ratios(count)
	local ratios = {}
	if count == 2 then
		ratios[1] = 1 / 3
		ratios[2] = 2 / 3
		return ratios
	end

	for index = 1, count do
		ratios[index] = 1 / count
	end

	return ratios
end

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

local function row_ratios_for_workspace(key, count)
	local ratios = key and row_ratios_by_workspace[key] or nil
	if not ratios or #ratios ~= count then
		ratios = default_row_ratios(count)
		if key then
			row_ratios_by_workspace[key] = ratios
		end
	end

	return ratios
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

local function place_rows(targets, ratios, x, y, width, height)
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
	local key = workspace_key(targets)
	local monitor = monitor_name(targets)
	local ratios = monitor == "HDMI-A-2" and row_ratios_for_workspace(key, count) or ratios_for_workspace(key, count)

	if monitor == "HDMI-A-2" then
		place_rows(targets, ratios, x, y, width, height)
		return
	elseif monitor ~= "DP-2" then
		place_columns(targets, ratios, x, y, width, height)
		return
	end

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

function M.resize(ctx, target, delta, corner)
	local targets = ctx.targets
	local count = targets and #targets or 0
	if count < 2 then
		return true
	end

	local key = workspace_key(targets)
	local order, targets_by_id = order_state.sync(state, key, targets)
	targets = order_state.targets_from_order(state, key, order, targets_by_id, targets)

	local area = ctx.area
	local ratios = ratios_for_workspace(key, count)
	local amount = resize_state.delta_ratio(delta, "x", area and area.w, resize_step)
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
	if count < 2 then
		return true
	end

	local command = msg:match("^(%S+)")
	local key = workspace_key(targets)
	local order, targets_by_id = order_state.sync(state, key, targets)
	targets = order_state.targets_from_order(state, key, order, targets_by_id, targets)

	if command == "swapprev" then
		move_active(targets, key, -1)
	elseif command == "swapnext" then
		move_active(targets, key, 1)
	elseif command == "resize-left" then
		M.resize(ctx, nil, { x = -resize_step }, nil)
	elseif command == "resize-right" then
		M.resize(ctx, nil, { x = resize_step }, nil)
	elseif command == "resize-x" then
		M.resize(ctx, nil, { x = tonumber(msg:match("^%S+%s+(-?%d+%.?%d*)")) or 0 }, nil)
	elseif command == "resize-x-at" then
		local edge, position = msg:match("^%S+%s+(%S+)%s+(-?%d+%.?%d*)")
		local area = ctx.area
		local ratios = ratios_for_workspace(key, count)
		local index = active_index(targets)
		local boundary = resize_state.boundary_for_edge(index, count, edge)
		resize_state.set_boundary_at(ratios, boundary, tonumber(position), area and area.x, area and area.w, min_ratio)
		if key then
			state.skip_position_by_key[key] = true
		end
	elseif command == "resize-y-at" then
		local edge, position = msg:match("^%S+%s+(%S+)%s+(-?%d+%.?%d*)")
		local area = ctx.area
		local ratios = row_ratios_for_workspace(key, count)
		local index = active_index(targets)
		local boundary = resize_state.boundary_for_edge(index, count, edge)
		resize_state.set_boundary_at(ratios, boundary, tonumber(position), area and area.y, area and area.h, min_ratio)
		if key then
			state.skip_position_by_key[key] = true
		end
	elseif command == "reset" then
		if key then
			ratios_by_workspace[key] = nil
			row_ratios_by_workspace[key] = nil
		end
	else
		return true
	end

	return true
end

hl.layout.register("ultrawide_master", {
	recalculate = M.recalculate,
	layout_msg = M.layout_msg,
	resize = M.resize,
})

return M

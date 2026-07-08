local M = {}
local monitor_role = require("lib.monitor_role")
local order_state = require("layouts.shared.order_state")
local ordered_axis = require("layouts.shared.ordered_axis")
local persistent_state = require("layouts.shared.persistent_state")
local resize_state = require("layouts.shared.resize_state")
local state = order_state.new()
local min_ratio = 0.15
local resize_step = 0.05
local ratios_two = { 0.67, 0.33 }
local ratios_three = { 0.3, 0.4, 0.3 }
local fallback_ratios = {}
local ratios_by_workspace = {}
local row_ratios_by_workspace = {}

local function state_file()
	return persistent_state.state_file("__ULTRAWIDE_MASTER_DISABLE_STATE", "__ULTRAWIDE_MASTER_STATE_FILE", "ultrawide-master-ratios.tsv")
end

local function save_ratio_state()
	persistent_state.save(state_file(), {
		{ kind = "columns", values = ratios_by_workspace },
		{ kind = "rows", values = row_ratios_by_workspace },
	}, state.order_by_key)
end

local function load_ratio_state()
	persistent_state.load(state_file(), {
		columns = ratios_by_workspace,
		rows = row_ratios_by_workspace,
	}, state.order_by_key)
end

load_ratio_state()

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

local function role_for_targets(targets)
	local first_role = nil
	for index = 1, #targets do
		local window = targets[index].window
		local role = monitor_role.for_window(window)
		if role == monitor_role.ultrawide then
			return role
		end

		first_role = first_role or role
	end

	return first_role
end

local function workspace_key(targets)
	return persistent_state.workspace_key(targets)
end

local function active_index(targets)
	return order_state.active_index(targets)
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

local function move_active(targets, key, delta)
	ordered_axis.move_active(state, key, targets, active_index, save_ratio_state, delta)
end

local function move_active_to_position(targets, key, ratios, area_x, area_width, position)
	ordered_axis.move_active_to_position(state, key, targets, active_index, save_ratio_state, "x", ratios, area_x, area_width, position)
end

local function place_columns(targets, ratios, x, y, width, height, scope)
	ordered_axis.place_weighted(state, targets, ratios, { x = x, y = y, w = width, h = height }, "x", scope)
end

local function place_rows(targets, ratios, x, y, width, height, scope)
	ordered_axis.place_weighted(state, targets, ratios, { x = x, y = y, w = width, h = height }, "y", scope)
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
	local role = role_for_targets(targets)
	local ratios = role == monitor_role.portrait and row_ratios_for_workspace(key, count) or ratios_for_workspace(key, count)

	if role == monitor_role.portrait then
		place_rows(targets, ratios, x, y, width, height, nil)
		return
	elseif role ~= monitor_role.ultrawide then
		place_columns(targets, ratios, x, y, width, height, nil)
		return
	end

	local previous_active = key and state.active_by_key[key] or nil
	local scope = nil
	targets, scope = ordered_axis.recalculate_ordered({
		state = state,
		key = key,
		targets = targets,
		layout_name = "ultrawide_master",
		role = role,
		axis = "x",
		start = x,
		span = width,
		insert_after_id = previous_active,
		active_index = active_index,
		save_state = save_ratio_state,
	})

	place_columns(targets, ratios, x, y, width, height, scope)
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
	if not index then
		return true
	end

	resize_state.adjust_active(ratios, index, count, amount, min_ratio)
	if key then
		state.manual_change_by_key[key] = true
		save_ratio_state()
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
	elseif command == "place-at-cursor" then
		local area = ctx.area
		local ratios = ratios_for_workspace(key, count)
		move_active_to_position(targets, key, ratios, area and area.x, area and area.w, order_state.cursor_position("x"))
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
		if not index then
			return true
		end

		local boundary = resize_state.boundary_for_edge(index, count, edge)
		resize_state.set_boundary_at(ratios, boundary, tonumber(position), area and area.x, area and area.w, min_ratio)
		if key then
			state.manual_change_by_key[key] = true
			save_ratio_state()
		end
	elseif command == "resize-y-at" then
		local edge, position = msg:match("^%S+%s+(%S+)%s+(-?%d+%.?%d*)")
		local area = ctx.area
		local ratios = row_ratios_for_workspace(key, count)
		local index = active_index(targets)
		if not index then
			return true
		end

		local boundary = resize_state.boundary_for_edge(index, count, edge)
		resize_state.set_boundary_at(ratios, boundary, tonumber(position), area and area.y, area and area.h, min_ratio)
		if key then
			state.manual_change_by_key[key] = true
			save_ratio_state()
		end
	elseif command == "reset" then
		if key then
			ratios_by_workspace[key] = nil
			row_ratios_by_workspace[key] = nil
			save_ratio_state()
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

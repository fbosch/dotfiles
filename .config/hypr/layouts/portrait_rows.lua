local M = {}
local monitor_role = require("lib.monitor_role")
local order_state = require("layouts.shared.order_state")
local ordered_axis = require("layouts.shared.ordered_axis")
local persistent_state = require("layouts.shared.persistent_state")
local resize_state = require("layouts.shared.resize_state")
local one_third = 1 / 3
local min_ratio = 0.15
local resize_step = 0.05
local ratios_by_workspace = {}
local state = order_state.new()

local function state_file()
	return persistent_state.state_file("__PORTRAIT_ROWS_DISABLE_STATE", "__PORTRAIT_ROWS_STATE_FILE", "portrait-rows-ratios.tsv")
end

local function save_ratio_state()
	persistent_state.save(state_file(), {
		{ kind = "rows", values = ratios_by_workspace },
	}, state.order_by_key)
end

local function load_ratio_state()
	persistent_state.load(state_file(), {
		rows = ratios_by_workspace,
	}, state.order_by_key, "rows")
end

load_ratio_state()

local function role_for_targets(targets)
	local first_role = nil
	for index = 1, #targets do
		local window = targets[index].window
		local role = monitor_role.for_window(window)
		if role == monitor_role.portrait then
			return role
		end

		first_role = first_role or role
	end

	return first_role
end

local function workspace_key(targets)
	return persistent_state.workspace_key(targets, role_for_targets(targets))
end

local function order_key(targets)
	return persistent_state.workspace_key(targets)
end

local function active_index(targets)
	return order_state.active_index(targets)
end

local function move_active(targets, key, delta)
	ordered_axis.move_active(state, key, targets, active_index, save_ratio_state, delta)
end

local function move_active_to_position(targets, key, ratios, area_y, area_height, position)
	ordered_axis.move_active_to_position(state, key, targets, active_index, save_ratio_state, "y", ratios, area_y, area_height, position)
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

local function place_rows(targets, count, x, y, width, height, scope)
	ordered_axis.place_even(state, targets, count, { x = x, y = y, w = width, h = height }, "y", scope)
end

local function place_ratio_rows(targets, ratios, x, y, width, height, scope)
	ordered_axis.place_weighted(state, targets, ratios, { x = x, y = y, w = width, h = height }, "y", scope)
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
		local role = role_for_targets(targets)
		if role == monitor_role.portrait then
			ordered_axis.remember_single(state, key, targets, "portrait_rows", role, "y", area.y + area.h / 2, active_index)
		end

		targets[1]:place(area)
		return
	end

	local x = area.x
	local y = area.y
	local width = area.w
	local height = area.h

	local role = role_for_targets(targets)
	if role ~= monitor_role.portrait then
		place_rows(targets, count, x, y, width, height, nil)
		return
	end

	local ratios = ratios_for(workspace_key(targets), count)
	local scope = nil
	targets, scope = ordered_axis.recalculate_ordered({
		state = state,
		key = key,
		targets = targets,
		layout_name = "portrait_rows",
		role = role,
		axis = "y",
		start = y,
		span = height,
		active_index = active_index,
		save_state = save_ratio_state,
	})

	if count == 2 or count == 3 then
		place_ratio_rows(targets, ratios, x, y, width, height, scope)
		return
	end

	place_rows(targets, count, x, y, width, height, scope)
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
	if not index then
		return true
	end

	resize_state.adjust_active(ratios, index, count, amount, min_ratio)
	if key then
		state.manual_change_by_key[key] = true
	end
	if ratio_key then
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
	local key = order_key(targets)
	local ratio_key = workspace_key(targets)
	local order, targets_by_id = order_state.sync(state, key, targets)
	targets = order_state.targets_from_order(state, key, order, targets_by_id, targets)

	if command == "swapprev" then
		move_active(targets, key, -1)
	elseif command == "swapnext" then
		move_active(targets, key, 1)
	elseif count > 3 then
		return true
	elseif command == "place-at-cursor" then
		local area = ctx.area
		local ratios = ratios_for(ratio_key, count)
		move_active_to_position(targets, key, ratios, area and area.y, area and area.h, order_state.cursor_position("y"))
	elseif command == "resize-up" then
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
		if not index then
			return true
		end

		local boundary = resize_state.boundary_for_edge(index, count, edge)
		resize_state.set_boundary_at(ratios, boundary, tonumber(position), area and area.y, area and area.h, min_ratio)
		if key then
			state.manual_change_by_key[key] = true
		end
		if ratio_key then
			save_ratio_state()
		end
	elseif command == "reset" then
		if ratio_key then
			ratios_by_workspace[ratio_key] = default_ratios(count)
			save_ratio_state()
		end
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

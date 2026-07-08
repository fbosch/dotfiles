local M = {}
local monitor_role = require("lib.monitor_role")
local order_state = require("layouts.order_state")
local persistent_state = require("layouts.persistent_state")
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
	if order_state.move_active(state, key, targets, active_index, delta) then
		save_ratio_state()
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

local function move_active_to_position(targets, key, ratios, area_x, area_width, position)
	local active = active_index(targets)
	local target_index = desired_index(position or order_state.position(targets[active], "x"), ratios, area_x, area_width)
	if not target_index or target_index == active then
		return
	end

	if order_state.move_active_to_index(state, key, targets, active_index, target_index) then
		save_ratio_state()
	end
end

local function place_columns(targets, ratios, x, y, width, height, scope)
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
		order_state.remember_position(state, targets[index], scope, box.x + box.w / 2, "x")
		next_x = next_x + box.w
	end
end

local function place_rows(targets, ratios, x, y, width, height, scope)
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
		order_state.remember_position(state, targets[index], scope, box.y + box.h / 2, "y")
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
	local role = role_for_targets(targets)
	local ratios = role == monitor_role.portrait and row_ratios_for_workspace(key, count) or ratios_for_workspace(key, count)

	if role == monitor_role.portrait then
		place_rows(targets, ratios, x, y, width, height, nil)
		return
	elseif role ~= monitor_role.ultrawide then
		place_columns(targets, ratios, x, y, width, height, nil)
		return
	end

	local manual_change = state.manual_change_by_key[key]
	local source_targets = targets
	local scope = order_state.scope("ultrawide_master", key, role, "x")
	local cleared_stale_order = order_state.clear_order_if_stale(state, key, source_targets)
	local needs_state_save = key and state.order_by_key[key] == nil
	order_state.initialize_order_from_geometry(state, key, source_targets, "x", x, width)
	local previous_active = key and state.active_by_key[key] or nil
	local order, targets_by_id, _, added_seen_targets, added_id = order_state.sync(state, key, source_targets, previous_active, true)
	needs_state_save = needs_state_save or cleared_stale_order or added_id ~= nil
	targets = order_state.targets_from_order(state, key, order, targets_by_id, source_targets)
	local transfer_target = nil
	local transfer_intent = nil
	for index = 1, #targets do
		local intent = order_state.consume_transfer_intent_by_id(targets[index], role, "x")
		if intent then
			transfer_target = targets[index]
			transfer_intent = intent
			break
		end
	end
	local has_transfer_intent = order_state.has_transfer_intent(role, "x")
	if has_transfer_intent and not transfer_target and added_id then
		local added_target = targets_by_id and targets_by_id[added_id] or nil
		local intent = added_target and order_state.consume_transfer_intent(added_target, role, "x", true) or nil
		if intent then
			transfer_target = added_target
			transfer_intent = intent
		end
	end
	if has_transfer_intent and not transfer_target then
		local outside_target = nil
		for index = 1, #targets do
			local position = order_state.position(targets[index], "x")
			if position and (position < x or position > x + width) then
				if outside_target then
					outside_target = nil
					break
				end
				outside_target = targets[index]
			end
		end
		local intent = outside_target and order_state.consume_transfer_intent(outside_target, role, "x", true) or nil
		if intent then
			transfer_target = outside_target
			transfer_intent = intent
		end
	end
	if transfer_target then
		local target_index = transfer_intent and transfer_intent.edge == "end" and #targets or 1
		order_state.move_target_to_index(state, key, transfer_target, target_index)
		state.manual_change_by_key[key] = nil
		needs_state_save = true
		targets = order_state.targets_from_order(state, key, order, targets_by_id, source_targets)
	elseif manual_change then
		state.manual_change_by_key[key] = nil
		needs_state_save = true
	end

	place_columns(targets, ratios, x, y, width, height, scope)
	order_state.remember_active(state, key, source_targets, active_index)
	if needs_state_save then
		save_ratio_state()
	end
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

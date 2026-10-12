local order_state = require("layouts.shared.order_state")
local intents = require("layouts.shared.intents")

local M = {}

local function axis_fields(axis)
	if axis == "x" then
		return "x", "w", "y", "h"
	end

	return "y", "h", "x", "w"
end

local function desired_index(center, ratios, start, span)
	if not center then
		return nil
	end

	local offset = center - start
	local boundary = 0
	for index = 1, #ratios do
		boundary = boundary + span * ratios[index]
		if offset < boundary then
			return index
		end
	end

	return #ratios
end

function M.nearest_slot_index(position, ratios, start, span)
	if not position or not start or not span then
		return nil
	end

	local slot_start = start
	local nearest_index = nil
	local nearest_distance = math.huge
	for index = 1, #ratios do
		local slot_span = span * ratios[index]
		local distance = math.abs(position - (slot_start + slot_span / 2))
		if distance < nearest_distance then
			nearest_index = index
			nearest_distance = distance
		end
		slot_start = slot_start + slot_span
	end

	return nearest_index
end

function M.move_active(state, key, targets, active_index, save_state, delta)
	if order_state.move_active(state, key, targets, active_index, delta) then
		save_state()
	end
end

function M.move_active_to_position(state, key, targets, active_index, save_state, axis, ratios, start, span, position)
	local active = active_index(targets)
	local target_index = desired_index(position or order_state.position(targets[active], axis), ratios, start, span)
	if not target_index or target_index == active then
		return false
	end

	if order_state.move_active_to_index(state, key, targets, active_index, target_index) then
		save_state()
		return true
	end

	return false
end

function M.move_target_to_nearest_position(state, key, targets, target, save_state, axis, ratios, start, span, position)
	local target_index = M.nearest_slot_index(position, ratios, start, span)
	if not target_index or not order_state.target_id(target) then
		return false
	end

	if order_state.move_target_to_visible_index(state, key, target, targets, target_index) then
		save_state()
		return true
	end

	return false
end

function M.place_weighted(state, targets, ratios, area, axis, scope)
	local variable_start, variable_span, fixed_start, fixed_span = axis_fields(axis)
	local next_start = area[variable_start]
	local box = {}
	box[fixed_start] = area[fixed_start]
	box[fixed_span] = area[fixed_span]

	for index = 1, #targets do
		box[variable_start] = next_start
		box[variable_span] = area[variable_span] * ratios[index]
		if index == #targets then
			box[variable_span] = area[variable_start] + area[variable_span] - next_start
		end

		targets[index]:place(box)
		order_state.remember_position(state, targets[index], scope, box[variable_start] + box[variable_span] / 2, axis)
		next_start = next_start + box[variable_span]
	end
end

function M.place_even(state, targets, count, area, axis, scope)
	local variable_start, variable_span, fixed_start, fixed_span = axis_fields(axis)
	local item_span = area[variable_span] / count
	local box = {}
	box[fixed_start] = area[fixed_start]
	box[fixed_span] = area[fixed_span]
	box[variable_span] = item_span

	for index = 1, count do
		box[variable_start] = area[variable_start] + item_span * (index - 1)
		targets[index]:place(box)
		order_state.remember_position(state, targets[index], scope, box[variable_start] + box[variable_span] / 2, axis)
	end
end

function M.remember_single(state, key, targets, layout_name, role, axis, center, active_index)
	intents.prune_drop_intents(layout_name, key, targets)
	intents.consume_drop_intent(targets[1], layout_name, key, role, axis)
	local scope = order_state.scope(layout_name, key, role, axis)
	order_state.sync(state, key, targets, nil, true)
	intents.consume_transfer_intent(targets[1], role, axis, true)
	intents.consume_placement_intent(targets[1], layout_name, key, role, axis)
	order_state.remember_active(state, key, targets, active_index)
	order_state.remember_position(state, targets[1], scope, center, axis)
end

function M.recalculate_ordered(opts)
	local state = opts.state
	local key = opts.key
	local source_targets = opts.targets
	-- Check globally so a workspace change still discards mismatched pending drops.
	local has_drop_intents = intents.has_drop_intents()
	if has_drop_intents then
		intents.prune_drop_intents(opts.layout_name, key, source_targets)
	end
	local axis = opts.axis
	local role = opts.role
	local manual_change = state.manual_change_by_key[key]
	local scope = order_state.scope(opts.layout_name, key, role, axis)
	local cleared_stale_order = order_state.clear_order_if_stale(state, key, source_targets)
	local needs_state_save = key and state.order_by_key[key] == nil
	order_state.initialize_order_from_geometry(state, key, source_targets, axis, opts.start, opts.span)
	local order, targets_by_id, _, _, added_id =
		order_state.sync(state, key, source_targets, opts.insert_after_id, true)
	needs_state_save = needs_state_save or cleared_stale_order or added_id ~= nil
	local targets = order_state.targets_from_order(state, key, order, targets_by_id, source_targets)
	local drop_target = nil
	local drop_intent = nil
	if has_drop_intents then
		for index = 1, #targets do
			local intent = intents.consume_drop_intent(targets[index], opts.layout_name, key, role, axis)
			if intent then
				drop_target = targets[index]
				drop_intent = intent
				break
			end
		end
	end

	if drop_target then
		if
			M.move_target_to_nearest_position(
				state,
				key,
				targets,
				drop_target,
				opts.save_state,
				axis,
				opts.ratios,
				opts.start,
				opts.span,
				drop_intent.position
			)
		then
			needs_state_save = false
			targets = order_state.targets_from_order(state, key, order, targets_by_id, source_targets)
		end
	end
	local placement_target = nil
	local placement_intent = nil
	for index = 1, #targets do
		local intent = intents.consume_placement_intent(targets[index], opts.layout_name, key, role, axis)
		if intent then
			placement_target = targets[index]
			placement_intent = intent
			break
		end
	end

	if placement_target then
		local target_index = M.nearest_slot_index(placement_intent.position, opts.ratios, opts.start, opts.span)
		if order_state.move_target_to_visible_index(state, key, placement_target, targets, target_index) then
			state.manual_change_by_key[key] = nil
			needs_state_save = true
			targets = order_state.targets_from_order(state, key, order, targets_by_id, source_targets)
		end
	end

	local transfer_target = nil
	local transfer_intent = nil
	for index = 1, #targets do
		local intent = intents.consume_transfer_intent_by_id(targets[index], role, axis)
		if intent then
			transfer_target = targets[index]
			transfer_intent = intent
			break
		end
	end

	local has_transfer_intent = intents.has_transfer_intent(role, axis)
	if has_transfer_intent and not transfer_target and added_id then
		local added_target = targets_by_id and targets_by_id[added_id] or nil
		local intent = added_target and intents.consume_transfer_intent(added_target, role, axis, true) or nil
		if intent then
			transfer_target = added_target
			transfer_intent = intent
		end
	end

	if has_transfer_intent and not transfer_target then
		local outside_target = nil
		for index = 1, #targets do
			local position = order_state.position(targets[index], axis)
			if position and (position < opts.start or position > opts.start + opts.span) then
				if outside_target then
					outside_target = nil
					break
				end
				outside_target = targets[index]
			end
		end

		local intent = outside_target and intents.consume_transfer_intent(outside_target, role, axis, true) or nil
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

	order_state.remember_active(state, key, source_targets, opts.active_index)
	if needs_state_save then
		opts.save_state()
	end

	return targets, scope
end

return M

local M = {}
local pending_transfer_by_id = {}
local pending_transfer_by_destination = {}

local function transfer_destination(monitor_role, axis)
	local by_axis = pending_transfer_by_destination[monitor_role]
	return by_axis and by_axis[axis] or nil
end

local function set_transfer_destination(monitor_role, axis, intent)
	local by_axis = pending_transfer_by_destination[monitor_role]
	if not by_axis then
		by_axis = {}
		pending_transfer_by_destination[monitor_role] = by_axis
	end

	by_axis[axis] = intent
end

local function clear_transfer_destination(monitor_role, axis)
	local by_axis = pending_transfer_by_destination[monitor_role]
	if by_axis then
		by_axis[axis] = nil
	end
end

function M.new()
	return {
		order_by_key = {},
		targets_by_key = {},
		target_maps_by_key = {},
		manual_change_by_key = {},
		active_by_key = {},
		position_by_scope = {},
		scope_by_id = {},
		seen_ids = {},
	}
end

function M.target_id(target)
	local window = target and target.window
	return window and window.address or nil
end

function M.window_id(window)
	return window and window.address or nil
end

function M.index_of(list, value)
	for index = 1, #list do
		if list[index] == value then
			return index
		end
	end

	return nil
end

function M.active_index(targets)
	local active_window = hl and hl.get_active_window and hl.get_active_window() or nil
	local active_id = M.window_id(active_window)
	if active_id then
		for index = 1, #targets do
			if M.target_id(targets[index]) == active_id then
				return index
			end
		end
	end

	local active = nil
	for index = 1, #targets do
		local window = targets[index].window
		if window and window.active then
			if active then
				return nil
			end
			active = index
		end
	end

	return active
end

function M.active_id(targets, active_index)
	local active = active_index(targets)
	if not active then
		return nil
	end

	return M.target_id(targets[active])
end

function M.position(target, axis)
	local window = target and target.window
	local at = window and window.at
	local size = window and window.size
	local start = at and at[axis]
	if not start then
		return nil
	end

	local length = size and size[axis] or 0
	return start + length / 2
end

function M.position_changed(state, target, scope, axis)
	local current = M.position(target, axis)
	if not current then
		return false
	end

	local id = M.target_id(target)
	local previous = state.position_by_scope[scope]
	previous = previous and previous[id]
	return previous ~= nil and math.abs(current - previous) > 1
end

function M.position_in_area(target, axis, start, length)
	local current = M.position(target, axis)
	return current ~= nil and current >= start and current <= start + length
end

function M.scope(layout, key, monitor_role, axis)
	if not key or not monitor_role then
		return nil
	end

	return layout .. "\t" .. tostring(key) .. "\t" .. monitor_role .. "\t" .. axis
end

function M.same_scope(state, target, scope)
	local id = M.target_id(target)
	return id ~= nil and state.scope_by_id[id] == scope
end

function M.remember_position(state, target, scope, center)
	if not scope then
		return
	end

	local id = M.target_id(target)
	if not id then
		return
	end

	local positions = state.position_by_scope[scope]
	if not positions then
		positions = {}
		state.position_by_scope[scope] = positions
	end

	positions[id] = center
	state.scope_by_id[id] = scope
end

function M.remember_active(state, key, targets, active_index)
	if key then
		local id = M.active_id(targets, active_index)
		if id then
			state.active_by_key[key] = id
		end
	end
end

function M.record_transfer_intent(window, intent)
	local id = M.window_id(window)
	if id then
		pending_transfer_by_id[id] = intent
	end

	set_transfer_destination(intent.monitor_role, intent.axis, intent)
end

function M.consume_transfer_intent(target, monitor_role, axis, allow_destination_fallback)
	local id = M.target_id(target)
	local intent = id and pending_transfer_by_id[id] or nil
	if intent and intent.monitor_role == monitor_role and intent.axis == axis then
		pending_transfer_by_id[id] = nil
		clear_transfer_destination(monitor_role, axis)
		return intent
	end

	local window = target and target.window
	intent = (allow_destination_fallback or window and window.active) and transfer_destination(monitor_role, axis) or nil
	if not intent then
		return nil
	end

	clear_transfer_destination(monitor_role, axis)
	return intent
end

function M.has_transfer_intent(monitor_role, axis)
	return transfer_destination(monitor_role, axis) ~= nil
end

function M.transfer_intent_for_window(window)
	return pending_transfer_by_id[M.window_id(window)]
end

function M.identities_safe(targets)
	local ids = {}
	for index = 1, #targets do
		local id = M.target_id(targets[index])
		if not id or ids[id] then
			return false
		end

		ids[id] = true
	end

	return true
end

function M.initialize_order_from_geometry(state, key, targets, axis, start, length)
	if not key or state.order_by_key[key] or not M.identities_safe(targets) then
		return
	end

	local sorted = {}
	for index = 1, #targets do
		local target = targets[index]
		local position = M.position(target, axis)
		if not position or position < start or position > start + length then
			return
		end

		sorted[index] = { id = M.target_id(target), position = position }
	end

	table.sort(sorted, function(first, second)
		return first.position < second.position
	end)

	local order = {}
	for index = 1, #sorted do
		order[index] = sorted[index].id
	end
	state.order_by_key[key] = order
end

function M.sync(state, key, targets, insert_after_id)
	if not key then
		return nil, nil, false, false
	end

	local order = state.order_by_key[key]
	if not order then
		order = {}
		state.order_by_key[key] = order
	end

	local targets_by_id = state.target_maps_by_key[key]
	if not targets_by_id then
		targets_by_id = {}
		state.target_maps_by_key[key] = targets_by_id
	else
		for id in pairs(targets_by_id) do
			targets_by_id[id] = nil
		end
	end

	for index = 1, #targets do
		local target = targets[index]
		local id = M.target_id(target)
		if not id or targets_by_id[id] then
			return nil, nil, false, false
		end

		targets_by_id[id] = target
	end

	local next_index = 1
	for index = 1, #order do
		local id = order[index]
		if targets_by_id[id] then
			order[next_index] = id
			next_index = next_index + 1
		end
	end
	for index = next_index, #order do
		order[index] = nil
	end

	local added = false
	local added_seen = false
	local added_id = nil
	local seen_ids = state.seen_ids
	for index = 1, #targets do
		local id = M.target_id(targets[index])
		if not M.index_of(order, id) then
			if added_id == nil then
				added_id = id
			else
				added_id = false
			end

			if seen_ids[id] then
				added_seen = true
			end

			local insert_at = #order + 1
			local after_index = insert_after_id and M.index_of(order, insert_after_id) or nil
			if after_index then
				insert_at = after_index + 1
			end

			table.insert(order, insert_at, id)
			insert_after_id = id
			added = true
		end
		seen_ids[id] = true
	end

	return order, targets_by_id, added, added_seen, added_id
end

function M.targets_from_order(state, key, order, targets_by_id, source_targets)
	if not order then
		return source_targets
	end

	local targets = state.targets_by_key[key]
	if not targets then
		targets = {}
		state.targets_by_key[key] = targets
	end

	for index = 1, #order do
		targets[index] = targets_by_id[order[index]]
	end
	for index = #order + 1, #targets do
		targets[index] = nil
	end

	return targets
end

function M.move_active(state, key, targets, active_index, delta)
	local order = M.sync(state, key, targets)
	if not order then
		return false
	end

	local active = active_index(targets)
	if not active then
		return false
	end

	local id = M.target_id(targets[active])
	local index = M.index_of(order, id)
	local next_index = index and index + delta
	if not index or next_index < 1 or next_index > #order then
		return false
	end

	order[index], order[next_index] = order[next_index], order[index]
	if key then
		state.manual_change_by_key[key] = true
	end

	return true
end

function M.move_active_to_index(state, key, targets, active_index, target_index)
	local active = active_index(targets)
	if not active then
		return false
	end

	if not target_index or target_index == active then
		return false
	end

	local order = state.order_by_key[key]
	if not order then
		return false
	end

	local id = M.target_id(targets[active])
	local order_index = M.index_of(order, id)
	if not order_index then
		return false
	end

	table.remove(order, order_index)
	table.insert(order, target_index, id)
	return true
end

function M.move_target_to_index(state, key, target, target_index)
	local order = state.order_by_key[key]
	if not order or not target_index then
		return false
	end

	local id = M.target_id(target)
	local order_index = M.index_of(order, id)
	if not order_index or order_index == target_index then
		return false
	end

	table.remove(order, order_index)
	table.insert(order, target_index, id)
	state.manual_change_by_key[key] = true
	return true
end

return M

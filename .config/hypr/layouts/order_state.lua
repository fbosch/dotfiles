local M = {}

function M.new()
	return {
		order_by_key = {},
		placed_by_key = {},
		targets_by_key = {},
		target_maps_by_key = {},
		skip_position_by_key = {},
	}
end

function M.target_id(target)
	local window = target and target.window
	local id = window and window.stable_id or target and target.index
	return id or target
end

function M.remember_placed(state, key, target, box)
	if not key then
		return
	end

	local placed = state.placed_by_key[key]
	if not placed then
		placed = {}
		state.placed_by_key[key] = placed
	end

	placed[M.target_id(target)] = { x = box.x, y = box.y, w = box.w, h = box.h }
end

function M.moved_since_placed(state, key, target, axis)
	local placed = key and state.placed_by_key[key] or nil
	local previous = placed and placed[M.target_id(target)] or nil
	local window = target and target.window
	local at = window and window.at
	local size = window and window.size
	if not previous or not at or not size then
		return false
	end

	local position_key = axis == "y" and "y" or "x"
	local size_key = axis == "y" and "h" or "w"
	local current_size = axis == "y" and size.y or size.x
	local tolerance = 1

	return math.abs((at[position_key] or 0) - previous[position_key]) > tolerance
		or math.abs((current_size or 0) - previous[size_key]) > tolerance
end

function M.index_of(list, value)
	for index = 1, #list do
		if list[index] == value then
			return index
		end
	end

	return nil
end

function M.sync(state, key, targets)
	if not key then
		return nil, nil
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
		targets_by_id[M.target_id(target)] = target
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

	for index = 1, #targets do
		local id = M.target_id(targets[index])
		if not M.index_of(order, id) then
			order[#order + 1] = id
		end
	end

	return order, targets_by_id
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
	local active = active_index(targets)
	local id = M.target_id(targets[active])
	local index = M.index_of(order, id)
	local next_index = index and index + delta
	if not index or next_index < 1 or next_index > #order then
		return
	end

	order[index], order[next_index] = order[next_index], order[index]
	if key then
		state.skip_position_by_key[key] = true
	end
end

function M.move_active_to_index(state, key, targets, active_index, target_index)
	local active = active_index(targets)
	if not target_index or target_index == active then
		return
	end

	local order = state.order_by_key[key]
	if not order then
		return
	end

	local id = M.target_id(targets[active])
	table.remove(order, active)
	table.insert(order, target_index, id)
end

return M

local M = {}

function M.new()
	return {
		order_by_key = {},
		targets_by_key = {},
		target_maps_by_key = {},
		skip_position_by_key = {},
		active_by_key = {},
	}
end

function M.target_id(target)
	local window = target and target.window
	if window then
		return window.address or window.stable_id or target
	end

	local id = target and target.index
	return id or target
end

function M.index_of(list, value)
	for index = 1, #list do
		if list[index] == value then
			return index
		end
	end

	return nil
end

function M.active_id(targets, active_index)
	local active = active_index(targets)
	return M.target_id(targets[active])
end

function M.remember_active(state, key, targets, active_index)
	if key then
		state.active_by_key[key] = M.active_id(targets, active_index)
	end
end

function M.sync(state, key, targets, insert_after_id)
	if not key then
		return nil, nil, false
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

	local added = false
	for index = 1, #targets do
		local id = M.target_id(targets[index])
		if not M.index_of(order, id) then
			local insert_at = #order + 1
			local after_index = insert_after_id and M.index_of(order, insert_after_id) or nil
			if after_index then
				insert_at = after_index + 1
			end

			table.insert(order, insert_at, id)
			insert_after_id = id
			added = true
		end
	end

	return order, targets_by_id, added
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

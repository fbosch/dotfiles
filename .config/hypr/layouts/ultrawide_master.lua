local M = {}
local box = {}
local order_by_workspace = {}
local targets_by_workspace = {}
local target_maps_by_workspace = {}
local skip_position_order_by_workspace = {}
local ratios_two = { 0.67, 0.33 }
local ratios_three = { 0.3, 0.4, 0.3 }
local fallback_ratios = {}

local function target_id(target)
	local window = target and target.window
	local id = window and window.stable_id or target and target.index
	return id or target
end

local function index_of(list, value)
	for index = 1, #list do
		if list[index] == value then
			return index
		end
	end

	return nil
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

local function sync_order(key, targets)
	if not key then
		return nil, nil
	end

	local order = order_by_workspace[key]
	if not order then
		order = {}
		order_by_workspace[key] = order
	end

	local targets_by_id = target_maps_by_workspace[key]
	if not targets_by_id then
		targets_by_id = {}
		target_maps_by_workspace[key] = targets_by_id
	else
		for id in pairs(targets_by_id) do
			targets_by_id[id] = nil
		end
	end

	for index = 1, #targets do
		local target = targets[index]
		targets_by_id[target_id(target)] = target
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
		local id = target_id(targets[index])
		if not index_of(order, id) then
			order[#order + 1] = id
		end
	end

	return order, targets_by_id
end

local function targets_from_order(key, order, targets_by_id, source_targets)
	if not order then
		return source_targets
	end

	local targets = targets_by_workspace[key]
	if not targets then
		targets = {}
		targets_by_workspace[key] = targets
	end

	for index = 1, #order do
		targets[index] = targets_by_id[order[index]]
	end
	for index = #order + 1, #targets do
		targets[index] = nil
	end

	return targets
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

	local order = order_by_workspace[key]
	if not order then
		return
	end

	local id = target_id(targets[active])
	table.remove(order, active)
	table.insert(order, target_index, id)
end

local function move_active(targets, key, delta)
	local order = sync_order(key, targets)
	local active = active_index(targets)
	local id = target_id(targets[active])
	local index = index_of(order, id)
	local next_index = index and index + delta
	if not index or next_index < 1 or next_index > #order then
		return
	end

	order[index], order[next_index] = order[next_index], order[index]
	if key then
		skip_position_order_by_workspace[key] = true
	end
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
	local ratios = ratios_for(count)

	if monitor_name(targets) ~= "DP-2" then
		place_columns(targets, ratios, x, y, width, height)
		return
	end

	local key = workspace_key(targets)
	local skip_position_order = skip_position_order_by_workspace[key]
	local source_targets = targets
	local order, targets_by_id = sync_order(key, source_targets)
	targets = targets_from_order(key, order, targets_by_id, source_targets)
	if skip_position_order then
		skip_position_order_by_workspace[key] = nil
	else
		move_active_to_position(targets, key, ratios, x, width)
		targets = targets_from_order(key, order, targets_by_id, source_targets)
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
	local order, targets_by_id = sync_order(key, targets)
	targets = targets_from_order(key, order, targets_by_id, targets)

	if command == "swapprev" then
		move_active(targets, key, -1)
	elseif command == "swapnext" then
		move_active(targets, key, 1)
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

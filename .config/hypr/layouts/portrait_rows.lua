local M = {}
local one_third = 1 / 3
local min_ratio = 0.15
local resize_step = 0.05
local box = {}
local ratios_by_workspace = {}
local order_by_workspace = {}
local skip_position_order_by_workspace = {}

local function target_id(target)
	local window = target and target.window
	local id = window and window.stable_id or target and target.index
	return id and tostring(id) or tostring(target)
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

local function active_id(targets)
	local target = targets[active_index(targets)]
	return target and target_id(target) or nil
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

local function ordered_targets(targets)
	local ordered = {}
	local has_position = false

	for index = 1, #targets do
		local target = targets[index]
		local center = vertical_center(target)
		ordered[index] = { target = target, index = index, center = center }
		if center then
			has_position = true
		end
	end

	if not has_position then
		return targets
	end

	table.sort(ordered, function(left, right)
		if left.center and right.center then
			if left.center == right.center then
				return left.index < right.index
			end

			return left.center < right.center
		end

		if left.center then
			return true
		end

		if right.center then
			return false
		end

		return left.index < right.index
	end)

	local result = {}
	for index = 1, #ordered do
		result[index] = ordered[index].target
	end

	return result
end

local function store_order(key, targets)
	if not key then
		return
	end

	local order = {}
	for index = 1, #targets do
		order[index] = target_id(targets[index])
	end

	order_by_workspace[key] = order
end

local function sync_order(key, targets)
	local targets_by_id = {}
	local present = {}

	for index = 1, #targets do
		local id = target_id(targets[index])
		targets_by_id[id] = targets[index]
		present[id] = true
	end

	local previous = key and order_by_workspace[key] or nil
	local order = {}

	if previous then
		for index = 1, #previous do
			local id = previous[index]
			if present[id] then
				order[#order + 1] = id
			end
		end
	end

	for index = 1, #targets do
		local id = target_id(targets[index])
		if not index_of(order, id) then
			order[#order + 1] = id
		end
	end

	if key then
		order_by_workspace[key] = order
	end

	return order, targets_by_id
end

local function targets_from_order(order, targets_by_id)
	local targets = {}
	for index = 1, #order do
		targets[index] = targets_by_id[order[index]]
	end

	return targets
end

local function move_active(targets, key, delta)
	local order = sync_order(key, targets)
	local id = active_id(targets)
	local index = id and index_of(order, id)
	local next_index = index and index + delta
	if not index or next_index < 1 or next_index > #order then
		return
	end

	order[index], order[next_index] = order[next_index], order[index]
	if key then
		skip_position_order_by_workspace[key] = true
	end
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

local function clamp_delta(first, second, delta)
	if delta > 0 then
		return math.min(delta, second - min_ratio)
	end

	return math.max(delta, min_ratio - first)
end

local function adjust_boundary(ratios, first_index, delta)
	local second_index = first_index + 1
	if not ratios[first_index] or not ratios[second_index] then
		return
	end

	delta = clamp_delta(ratios[first_index], ratios[second_index], delta)
	ratios[first_index] = ratios[first_index] + delta
	ratios[second_index] = ratios[second_index] - delta
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

	local skip_position_order = skip_position_order_by_workspace[key]
	local order, targets_by_id = sync_order(key, targets)
	targets = targets_from_order(order, targets_by_id)
	if skip_position_order then
		skip_position_order_by_workspace[key] = nil
	else
		targets = ordered_targets(targets)
		store_order(key, targets)
	end

	box.x = x
	box.y = y
	box.w = width
	box.h = height

	if count == 2 or count == 3 then
		place_ratio_rows(targets, ratios_for(workspace_key(targets), count), x, y, width, height)
		return
	end

	place_rows(targets, count, x, y, width, height)
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
	local order, targets_by_id = sync_order(key, targets)
	targets = targets_from_order(order, targets_by_id)
	local ratios = ratios_for(ratio_key, count)
	local index = active_index(targets)

	if command == "resize-up" then
		if index > 1 then
			adjust_boundary(ratios, index - 1, -resize_step)
		else
			adjust_boundary(ratios, index, -resize_step)
		end
	elseif command == "resize-down" then
		if index < count then
			adjust_boundary(ratios, index, resize_step)
		else
			adjust_boundary(ratios, index - 1, resize_step)
		end
	elseif command == "reset" then
		if key then
			ratios_by_workspace[key] = default_ratios(count)
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
})

return M

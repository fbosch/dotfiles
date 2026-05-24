local M = {}
local one_third = 1 / 3
local min_ratio = 0.15
local resize_step = 0.05
local box = {}
local ratios_by_workspace = {}

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

local function active_index(targets)
	for index = 1, #targets do
		local window = targets[index].window
		if window and window.active then
			return index
		end
	end

	return 1
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
	local key = workspace_key(targets)
	local ratios = ratios_for(key, count)
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
	else
		return "portrait_rows: expected resize-up, resize-down, or reset"
	end

	return true
end

hl.layout.register("portrait_rows", {
	recalculate = M.recalculate,
	layout_msg = M.layout_msg,
})

return M

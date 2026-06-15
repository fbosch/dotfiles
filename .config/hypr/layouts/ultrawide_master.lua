local M = {}
local monitor_role = require("lib.monitor_role")
local order_state = require("layouts.order_state")
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
	if rawget(_G, "__ULTRAWIDE_MASTER_DISABLE_STATE") then
		return nil
	end

	local override = rawget(_G, "__ULTRAWIDE_MASTER_STATE_FILE")
	if override then
		return override
	end

	local runtime_dir = os.getenv("XDG_RUNTIME_DIR")
	local signature = os.getenv("HYPRLAND_INSTANCE_SIGNATURE")
	if not runtime_dir or runtime_dir == "" or not signature or signature == "" then
		return nil
	end

	return runtime_dir .. "/hypr/" .. signature .. "/ultrawide-master-ratios.tsv"
end

local function encode(value)
	return tostring(value):gsub("([^%w_.-])", function(char)
		return string.format("%%%02X", string.byte(char))
	end)
end

local function decode(value)
	return tostring(value):gsub("%%(%x%x)", function(hex)
		return string.char(tonumber(hex, 16))
	end)
end

local function serialize_ratios(ratios)
	local values = {}
	for index = 1, #ratios do
		values[index] = tostring(ratios[index])
	end

	return table.concat(values, ",")
end

local function parse_ratios(value)
	local ratios = {}
	for ratio in tostring(value):gmatch("[^,]+") do
		ratios[#ratios + 1] = tonumber(ratio)
	end

	return ratios
end

local function save_ratio_state()
	local path = state_file()
	if not path then
		return
	end

	local handle = io.open(path, "w")
	if not handle then
		return
	end

	for key, ratios in pairs(ratios_by_workspace) do
		handle:write("columns\t", encode(key), "\t", #ratios, "\t", serialize_ratios(ratios), "\n")
	end
	for key, ratios in pairs(row_ratios_by_workspace) do
		handle:write("rows\t", encode(key), "\t", #ratios, "\t", serialize_ratios(ratios), "\n")
	end

	handle:close()
end

local function load_ratio_state()
	local path = state_file()
	if not path then
		return
	end

	local handle = io.open(path, "r")
	if not handle then
		return
	end

	for line in handle:lines() do
		local kind, encoded_key, count, serialized = line:match("^(%S+)\t(%S+)\t(%d+)\t(.+)$")
		local ratios = serialized and parse_ratios(serialized) or nil
		if ratios and #ratios == tonumber(count) then
			if kind == "columns" then
				ratios_by_workspace[decode(encoded_key)] = ratios
			elseif kind == "rows" then
				row_ratios_by_workspace[decode(encoded_key)] = ratios
			end
		end
	end

	handle:close()
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
	order_state.move_active(state, key, targets, active_index, delta)
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
	local target_index = desired_index(order_state.position(targets[active], "x"), ratios, area_x, area_width)
	if not target_index or target_index == active then
		return
	end

	order_state.move_active_to_index(state, key, targets, active_index, target_index)
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
		order_state.remember_position(state, targets[index], scope, box.x + box.w / 2)
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
		order_state.remember_position(state, targets[index], scope, box.y + box.h / 2)
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
	order_state.initialize_order_from_geometry(state, key, source_targets, "x", x, width)
	local previous_active = key and state.active_by_key[key] or nil
	local order, targets_by_id, _, added_seen_targets = order_state.sync(state, key, source_targets, previous_active)
	targets = order_state.targets_from_order(state, key, order, targets_by_id, source_targets)
	local transfer_target = nil
	for index = 1, #targets do
		local intent = order_state.consume_transfer_intent(targets[index], role, "x")
		if intent then
			transfer_target = targets[index]
			break
		end
	end
	if transfer_target and order_state.move_target_to_index(state, key, transfer_target, 1) then
		targets = order_state.targets_from_order(state, key, order, targets_by_id, source_targets)
	elseif manual_change then
		state.manual_change_by_key[key] = nil
	else
		local active = active_index(targets)
		local active_target = active and targets[active] or nil
		if active_target
			and order_state.same_scope(state, active_target, scope)
			and order_state.position_in_area(active_target, "x", x, width)
			and (order_state.position_changed(state, active_target, scope, "x") or added_seen_targets)
		then
			move_active_to_position(targets, key, ratios, x, width)
			targets = order_state.targets_from_order(state, key, order, targets_by_id, source_targets)
		end
	end

	place_columns(targets, ratios, x, y, width, height, scope)
	order_state.remember_active(state, key, source_targets, active_index)
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

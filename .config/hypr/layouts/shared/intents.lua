local order_state = require("layouts.shared.order_state")

local M = {}

--- One-shot placement request consumed when a window enters a custom layout.
---@class TransferIntent
---@field monitor_role string Target monitor role.
---@field axis "x"|"y" Layout axis that consumes the request.
---@field edge "start"|"end" Insertion edge on that axis.

---@class PlacementIntent
---@field layout_name string Layout that consumes the request.
---@field workspace_key string Workspace the window is leaving.
---@field monitor_role string Target monitor role.
---@field axis "x"|"y" Layout axis that consumes the request.
---@field position number Center coordinate on that axis.

local pending_transfer_by_id = {}
local pending_transfer_by_destination = {}
local pending_transfer_destination_id = {}
local pending_placement_by_id = {}
local placement_intent_timeout = 2000

local function transfer_destination(monitor_role, axis)
	local by_axis = pending_transfer_by_destination[monitor_role]
	return by_axis and by_axis[axis] or nil
end

local function transfer_destination_id(monitor_role, axis)
	local by_axis = pending_transfer_destination_id[monitor_role]
	return by_axis and by_axis[axis] or nil
end

local function set_transfer_destination(monitor_role, axis, intent, id)
	local by_axis = pending_transfer_by_destination[monitor_role]
	if not by_axis then
		by_axis = {}
		pending_transfer_by_destination[monitor_role] = by_axis
	end
	local ids_by_axis = pending_transfer_destination_id[monitor_role]
	if not ids_by_axis then
		ids_by_axis = {}
		pending_transfer_destination_id[monitor_role] = ids_by_axis
	end

	by_axis[axis] = intent
	ids_by_axis[axis] = id
end

local function clear_transfer_destination(monitor_role, axis)
	local by_axis = pending_transfer_by_destination[monitor_role]
	if by_axis then
		by_axis[axis] = nil
	end
	local ids_by_axis = pending_transfer_destination_id[monitor_role]
	if ids_by_axis then
		ids_by_axis[axis] = nil
	end
end

function M.record_transfer_intent(window, intent)
	local id = order_state.window_id(window)
	local previous_id = transfer_destination_id(intent.monitor_role, intent.axis)
	if previous_id then
		pending_transfer_by_id[previous_id] = nil
	end

	if id then
		pending_transfer_by_id[id] = intent
	end

	set_transfer_destination(intent.monitor_role, intent.axis, intent, id)
end

function M.consume_transfer_intent(target, monitor_role, axis, allow_destination_fallback)
	local id = order_state.target_id(target)
	local intent = id and pending_transfer_by_id[id] or nil
	if intent and intent.monitor_role == monitor_role and intent.axis == axis then
		pending_transfer_by_id[id] = nil
		clear_transfer_destination(monitor_role, axis)
		return intent
	end

	local window = target and target.window
	intent = (allow_destination_fallback or window and window.active) and transfer_destination(monitor_role, axis)
		or nil
	if not intent then
		return nil
	end

	local destination_id = transfer_destination_id(monitor_role, axis)
	clear_transfer_destination(monitor_role, axis)
	if destination_id then
		pending_transfer_by_id[destination_id] = nil
	end
	return intent
end

function M.consume_transfer_intent_by_id(target, monitor_role, axis)
	local id = order_state.target_id(target)
	local intent = id and pending_transfer_by_id[id] or nil
	if intent and intent.monitor_role == monitor_role and intent.axis == axis then
		pending_transfer_by_id[id] = nil
		clear_transfer_destination(monitor_role, axis)
		return intent
	end

	return nil
end

function M.has_transfer_intent(monitor_role, axis)
	return transfer_destination(monitor_role, axis) ~= nil
end

function M.transfer_intent_for_window(window)
	return pending_transfer_by_id[order_state.window_id(window)]
end

function M.record_placement_intent(window, intent)
	local id = order_state.window_id(window)
	if not id then
		return false
	end

	pending_placement_by_id[id] = intent
	if hl and hl.timer then
		hl.timer(function()
			if pending_placement_by_id[id] == intent then
				pending_placement_by_id[id] = nil
			end
		end, { timeout = placement_intent_timeout, type = "oneshot" })
	end

	return true
end

function M.consume_placement_intent(target, layout_name, workspace_key, monitor_role, axis)
	local id = order_state.target_id(target)
	local intent = id and pending_placement_by_id[id] or nil
	if
		intent
		and intent.layout_name == layout_name
		and intent.workspace_key == workspace_key
		and intent.monitor_role == monitor_role
		and intent.axis == axis
	then
		pending_placement_by_id[id] = nil
		return intent
	end

	return nil
end

function M.placement_intent_for_window(window)
	return pending_placement_by_id[order_state.window_id(window)]
end

function M.observe_floating_active(state, key, targets)
	local active = hl and hl.get_active_window and hl.get_active_window() or nil
	if not active or active.floating ~= true or M.placement_intent_for_window(active) then
		return
	end

	local id = order_state.window_id(active)
	local order = key and state.order_by_key[key] or nil
	if not id or not order or not order_state.index_of(order, id) then
		return
	end

	for index = 1, #targets do
		if order_state.target_id(targets[index]) == id then
			return
		end
	end

	state.tiled_drag_by_key[key] = id
end

function M.consume_tiled_drag(state, key, targets)
	local id = key and state.tiled_drag_by_key[key] or nil
	if not id then
		return nil
	end

	for index = 1, #targets do
		local target = targets[index]
		if order_state.target_id(target) == id then
			state.tiled_drag_by_key[key] = nil
			return target
		end
	end

	return nil
end

return M

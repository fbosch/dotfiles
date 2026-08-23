local M = {}
local dispatch = hl.dispatch
local monitor_role = require("lib.monitor_role")
local state = require("lib.window.state")
local order_state = require("layouts.shared.order_state")
local intents = require("layouts.shared.intents")
local hypr_ipc = require("runtime.lib.hypr-ipc")
local control_protocol = require("runtime.windows.daemons.custom-layout-drag-resize.control-protocol")
local custom_layout_resize_command =
	"~/.config/hypr/runtime/windows/daemons/custom-layout-drag-resize/custom-layout-drag-resize.sh"
local custom_layout_resize_sequence_file = hypr_ipc.instance_path("custom-layout-drag-resize.sequence")
local float_toggle = hl.dsp.window.float()

local layout_contexts = {
	["lua:portrait_rows"] = {
		layout_name = "portrait_rows",
		monitor_role = monitor_role.portrait,
		axis = "y",
	},
	["lua:ultrawide_master"] = {
		layout_name = "ultrawide_master",
		monitor_role = monitor_role.ultrawide,
		axis = "x",
	},
}

local function workspace_key(workspace)
	return workspace and tostring(workspace.id or workspace.name) or nil
end

local function placement_intent(window)
	if not window or window.floating ~= true then
		return nil
	end

	local workspace = window.workspace
	local context = workspace and layout_contexts[workspace.tiled_layout] or nil
	if not context or monitor_role.for_window(window) ~= context.monitor_role then
		return nil
	end

	local at = window.at
	local size = window.size
	if not at or not size or not at.x or not at.y or not size.x or not size.y then
		return nil
	end

	local key = workspace_key(workspace)
	if not key or not order_state.window_id(window) then
		return nil
	end

	return {
		layout_name = context.layout_name,
		workspace_key = key,
		monitor_role = context.monitor_role,
		axis = context.axis,
		position = at[context.axis] + size[context.axis] / 2,
	}
end

local function custom_layout_resize(action)
	local sequence = control_protocol.next_sequence(custom_layout_resize_sequence_file)
	return hl.dsp.exec_cmd(string.format("%s %s %d", custom_layout_resize_command, action, sequence))
end

function M.place_custom_layout_at_cursor()
	if state.uses_any_custom_layout(state.active()) then
		dispatch(hl.dsp.layout("place-at-cursor"))
	end
end

function M.toggle_float()
	local window = state.active()
	local intent = placement_intent(window)
	if intent then
		intents.record_placement_intent(window, intent)
	end

	return dispatch(float_toggle)
end

function M.start_custom_layout_resize()
	local active = hl.get_active_window()
	local workspace = active and active.workspace
	if not active or active.floating == true or not layout_contexts[workspace and workspace.tiled_layout] then
		return false
	end

	M.reset_keep_aspect_ratio()
	dispatch(custom_layout_resize("start"))
	return true
end

function M.stop_custom_layout_resize()
	dispatch(custom_layout_resize("stop"))
end

function M.resize_keep_aspect_ratio()
	dispatch(custom_layout_resize("stop"))
	dispatch(hl.dsp.window.set_prop({ prop = "keep_aspect_ratio", value = "1" }))
	dispatch(hl.dsp.window.resize())
end

function M.reset_keep_aspect_ratio()
	dispatch(hl.dsp.window.set_prop({ prop = "keep_aspect_ratio", value = "0" }))
end

return M

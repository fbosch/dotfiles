local M = {}
local dispatch = hl.dispatch
local custom_layout_pointer = require("plugins.custom_layout_pointer")
local monitor_role = require("lib.monitor_role")
local order_state = require("layouts.shared.order_state")
local intents = require("layouts.shared.intents")
local profile_state = require("lib.profile_state")
local window_state = require("lib.window.state")
local window_tags = require("lib.window_tags")
local hypr_ipc = require("runtime.lib.hypr-ipc")
local control_protocol = require("runtime.windows.daemons.custom-layout-drag-resize.control-protocol")
local custom_layout_resize_command =
	"~/.config/hypr/runtime/windows/daemons/custom-layout-drag-resize/custom-layout-drag-resize.sh"
local custom_layout_resize_sequence_file = hypr_ipc.instance_path("custom-layout-drag-resize.sequence")
local float_toggle = hl.dsp.window.float()
local pointer_event_registered = false
-- Keep release paired with the native pointer path selected at press time
-- while the bridge and daemon coexist during the migration window.
local resize_backend = nil
local resize_context = nil

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

local function disable_resize_animation()
	hl.animation({ leaf = "windowsMove", enabled = false })
end

local function restore_resize_animation()
	local ok, mode = pcall(profile_state.resolved)
	if ok and mode ~= "default" then
		require("profiles").apply_current()
		return
	end

	require("animations").restore_windows_move()
end

local function resize_axis(layout, role)
	if layout == "lua:ultrawide_master" then
		if role == monitor_role.portrait then
			return "y", "resize-y-at"
		end

		return "x", "resize-x-at"
	end

	if layout == "lua:portrait_rows" then
		return "y", "resize-y-at"
	end
end

local function window_contains_cursor(window, cursor)
	local at = window and window.at
	local size = window and window.size
	return cursor
		and at
		and size
		and at.x
		and at.y
		and size.x
		and size.y
		and cursor.x >= at.x
		and cursor.x < at.x + size.x
		and cursor.y >= at.y
		and cursor.y < at.y + size.y
end

local function focus_history_rank(window)
	local rank = tonumber(window and window.focus_history_id)
	if not rank or rank < 0 then
		return math.huge
	end

	return rank
end

local function preferred_hover_candidate(candidate, current)
	if not current then
		return true
	end

	if candidate.floating == true and current.floating ~= true then
		return true
	elseif candidate.floating ~= true and current.floating == true then
		return false
	end

	return focus_history_rank(candidate) < focus_history_rank(current)
end

local function hovered_window(cursor)
	local best = nil
	for _, candidate in ipairs(hl.get_windows()) do
		if
			candidate.mapped ~= false
			and candidate.hidden ~= true
			and candidate.visible ~= false
			and candidate.accepts_input ~= false
			and window_contains_cursor(candidate, cursor)
			and preferred_hover_candidate(candidate, best)
		then
			best = candidate
		end
	end

	return best
end

local function pointer_target_window()
	local cursor = hl.get_cursor_pos and hl.get_cursor_pos() or nil
	local active = window_state.active()
	if window_contains_cursor(active, cursor) then
		return active, cursor
	end

	local hovered = cursor and hovered_window(cursor) or nil
	if hovered and hovered ~= active then
		dispatch(hl.dsp.focus({ window = hovered }))
	end

	return hovered or active, cursor
end

local function resize_edge(axis, cursor, at, size)
	local start = at and at[axis]
	local length = size and size[axis]
	local position = cursor and cursor[axis]
	if not start or not length or not position then
		return nil
	end

	if axis == "x" then
		return position < start + length / 2 and "left" or "right"
	end

	return position < start + length / 2 and "up" or "down"
end

local function pointer_resize_context(window, cursor)
	local workspace = window and window.workspace
	local layout = workspace and workspace.tiled_layout
	local axis, command = resize_axis(layout, monitor_role.for_window(window))
	local address = window and window.address
	if not axis or type(address) ~= "string" or not address:match("^0x%x+$") then
		return nil
	end

	local edge = resize_edge(axis, cursor, window.at, window.size)
	if not edge then
		return nil
	end

	return {
		axis = axis,
		command = command,
		edge = edge,
		target_id = "address:" .. address,
		last_position = nil,
	}
end

local function finish_pointer_resize()
	if resize_backend ~= "plugin" and resize_backend ~= "plugin-blocked" then
		return false
	end

	local active = resize_backend == "plugin" and resize_context ~= nil
	resize_backend = nil
	resize_context = nil
	if not active then
		return true
	end

	local plugin = custom_layout_pointer.api()
	if plugin then
		pcall(plugin.stop)
	end

	dispatch(hl.dsp.layout("save-resize"))
	restore_resize_animation()
	return true
end

local function start_pointer_resize()
	local plugin = pointer_event_registered and custom_layout_pointer.api() or nil
	if not plugin then
		return nil
	end

	local window, cursor = pointer_target_window()
	if not window then
		return false
	end

	local workspace = window.workspace
	if window.floating == true or not resize_axis(workspace and workspace.tiled_layout, monitor_role.for_window(window)) then
		return false
	end

	finish_pointer_resize()
	if window_tags.has(window.tags, window_tags.non_resizable) then
		resize_backend = "plugin-blocked"
		return true
	end

	local context = pointer_resize_context(window, cursor)
	if not context then
		resize_backend = "plugin-blocked"
		return true
	end

	M.reset_keep_aspect_ratio()
	resize_backend = "plugin"
	resize_context = context
	disable_resize_animation()
	local ok, started = pcall(plugin.start)
	if not ok or started ~= true then
		resize_backend = nil
		resize_context = nil
		restore_resize_animation()
		return nil
	end

	return true
end

function M.handle_pointer_motion(x, y)
	local context = resize_context
	if not context then
		return
	end

	local position = context.axis == "x" and tonumber(x) or tonumber(y)
	if not position then
		return
	end

	position = math.floor(position)
	if position == context.last_position then
		return
	end

	context.last_position = position
	dispatch(
		hl.dsp.layout(
			string.format("%s %s %s %d", context.command, context.target_id, context.edge, position)
		)
	)
end

function M.place_custom_layout_at_cursor(state)
	if state.uses_any_custom_layout(state.active()) then
		dispatch(hl.dsp.layout("place-at-cursor"))
	end
end

function M.toggle_float(state)
	local window = state.active()
	local intent = placement_intent(window)
	if intent then
		intents.record_placement_intent(window, intent)
	end

	return dispatch(float_toggle)
end

function M.start_custom_layout_resize()
	local pointer_result = start_pointer_resize()
	if pointer_result ~= nil then
		return pointer_result
	end

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
	if finish_pointer_resize() then
		return
	end

	resize_backend = nil
	dispatch(custom_layout_resize("stop"))
end

function M.resize_keep_aspect_ratio()
	if not finish_pointer_resize() then
		resize_backend = nil
		dispatch(custom_layout_resize("stop"))
	end
	dispatch(hl.dsp.window.set_prop({ prop = "keep_aspect_ratio", value = "1" }))
	dispatch(hl.dsp.window.resize())
end

function M.reset_keep_aspect_ratio()
	dispatch(hl.dsp.window.set_prop({ prop = "keep_aspect_ratio", value = "0" }))
end

if custom_layout_pointer.available() and type(hl.on) == "function" then
	hl.on("custom_layout_pointer.motion", M.handle_pointer_motion)
	pointer_event_registered = true
end

return M

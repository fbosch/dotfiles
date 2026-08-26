local M = {}
local dispatch = hl.dispatch
local monitor_role = require("lib.monitor_role")
local state = require("lib.window.state")
local order_state = require("layouts.shared.order_state")
local intents = require("layouts.shared.intents")
local window_tags = require("lib.window_tags")
local float_toggle = hl.dsp.window.float()
local resize_plugin = hl.plugin and hl.plugin.custom_layout_resize or nil
local native_resize_active = false
local native_resize_ready = false

local ultrawide_layout = "lua:ultrawide_master"
local portrait_layout = "lua:portrait_rows"

local layout_contexts = {
	[portrait_layout] = {
		layout_name = "portrait_rows",
		monitor_role = monitor_role.portrait,
		axis = "y",
	},
	[ultrawide_layout] = {
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

local function restore_resize_animation()
	local ok, mode = pcall(function()
		return require("lib.profile_state").resolved()
	end)
	if ok and mode ~= "default" then
		require("profiles").apply_current()
	else
		require("animations").restore_windows_move()
	end
end

if
	resize_plugin
	and type(resize_plugin.start) == "function"
	and type(resize_plugin.stop) == "function"
	and type(hl.on) == "function"
then
	local ok, subscription = pcall(hl.on, "custom_layout_resize.command", function(message)
		dispatch(hl.dsp.layout(message))
	end)
	if ok then
		native_resize_ready = true
		M._resize_command_subscription = subscription
	end
end

function M.place_custom_layout_at_cursor(target)
	if state.uses_any_custom_layout(target) then
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

function M.start_custom_layout_resize(target)
	local workspace = target and target.workspace
	if not target or target.floating == true or not layout_contexts[workspace and workspace.tiled_layout] then
		return false
	end

	if not native_resize_ready then
		return true
	end

	local ok, started, handled = pcall(
		resize_plugin.start,
		ultrawide_layout,
		portrait_layout,
		monitor_role.name_for(monitor_role.portrait),
		window_tags.non_resizable
	)
	if ok and handled == true and started == true then
		native_resize_active = true
		hl.animation({ leaf = "windowsMove", enabled = false })
	end
	return true
end

function M.stop_custom_layout_resize()
	if not native_resize_active then
		return
	end

	native_resize_active = false
	pcall(resize_plugin.stop)
	restore_resize_animation()
end

return M
